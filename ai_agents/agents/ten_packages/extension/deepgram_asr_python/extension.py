from datetime import datetime
import json
import os

from typing_extensions import override
from .const import (
    DUMP_FILE_NAME,
    MODULE_NAME_ASR,
)
from ten_ai_base.asr import (
    ASRBufferConfig,
    ASRBufferConfigModeDiscard,
    ASRResult,
    AsyncASRBaseExtension,
)
from ten_ai_base.message import (
    ModuleError,
    ModuleErrorVendorInfo,
    ModuleErrorCode,
)
from ten_runtime import (
    AsyncTenEnv,
    AudioFrame,
)
from ten_ai_base.const import (
    LOG_CATEGORY_KEY_POINT,
    LOG_CATEGORY_VENDOR,
)

import asyncio
from deepgram import (
    DeepgramClientOptions,
    LiveTranscriptionEvents,
    LiveOptions,
)
import deepgram
from .config import DeepgramASRConfig
from ten_ai_base.dumper import Dumper
from .reconnect_manager import ReconnectManager


class DeepgramASRExtension(AsyncASRBaseExtension):
    def __init__(self, name: str):
        super().__init__(name)
        self.connected: bool = False
        self.client: deepgram.AsyncListenWebSocketClient | None = None
        self.config: DeepgramASRConfig | None = None
        self.audio_dumper: Dumper | None = None
        self.sent_user_audio_duration_ms_before_last_reset: int = 0
        self.last_finalize_timestamp: int = 0

        # Reconnection manager with retry limits and backoff strategy
        self.reconnect_manager: ReconnectManager | None = None

    @override
    async def on_deinit(self, ten_env: AsyncTenEnv) -> None:
        await super().on_deinit(ten_env)
        if self.audio_dumper:
            await self.audio_dumper.stop()
            self.audio_dumper = None

    @override
    def vendor(self) -> str:
        """Get the name of the ASR vendor."""
        return "deepgram"

    @override
    async def on_init(self, ten_env: AsyncTenEnv) -> None:
        await super().on_init(ten_env)

        # Initialize reconnection manager
        self.reconnect_manager = ReconnectManager(logger=ten_env)

        config_json, _ = await ten_env.get_property_to_json("")

        try:
            self.config = DeepgramASRConfig.model_validate_json(config_json)
            self.config.update(self.config.params)
            ten_env.log_info(
                "KEYPOINT vendor_config loaded (values omitted)",
                category=LOG_CATEGORY_KEY_POINT,
            )

            if self.config.dump:
                dump_file_path = os.path.join(
                    self.config.dump_path, DUMP_FILE_NAME
                )
                self.audio_dumper = Dumper(dump_file_path)
        except Exception as e:
            ten_env.log_error(f"invalid property: {type(e).__name__}")
            self.config = DeepgramASRConfig.model_validate_json("{}")
            await self.send_asr_error(
                ModuleError(
                    module=MODULE_NAME_ASR,
                    code=ModuleErrorCode.FATAL_ERROR.value,
                    message=f"Invalid ASR configuration: {type(e).__name__}",
                ),
            )

    @override
    async def start_connection(self) -> None:
        assert self.config is not None
        self.ten_env.log_info("start_connection")

        try:
            await self.stop_connection()

            self.client = deepgram.AsyncListenWebSocketClient(
                config=DeepgramClientOptions(
                    url=self.config.url,
                    api_key=self.config.key or self.config.api_key,
                    options={"keepalive": "true"},
                )
            )

            if self.audio_dumper:
                await self.audio_dumper.start()

            await self._register_deepgram_event_handlers()

            keywords = []
            if self.config.hotwords:
                for hw in self.config.hotwords:
                    tokens = hw.split("|")
                    if len(tokens) == 2 and tokens[1].isdigit():
                        keywords.append(":".join(tokens))  # replase to ":"
                    else:
                        self.ten_env.log_warn("invalid hotword format (value omitted)")

            options = LiveOptions(
                language=self.config.language,
                model=self.config.model,
                sample_rate=self.input_audio_sample_rate(),
                channels=self.input_audio_channels(),
                encoding=self.config.encoding,
                interim_results=self.config.interim_results,
                punctuate=self.config.punctuate,
                keywords=keywords,
            )

            # Update options with advanced params
            if self.config.advanced_params_json:
                try:
                    params: dict[str, str] = json.loads(
                        self.config.advanced_params_json
                    )
                    for key, value in params.items():
                        if hasattr(
                            options, key
                        ) and not self.config.is_black_list_params(key):
                            self.ten_env.log_debug(
                                "Setting advanced Deepgram parameter (values omitted)"
                            )
                            setattr(options, key, value)
                except Exception as e:
                    self.ten_env.log_error(f"set deepgram param failed: {type(e).__name__}")

            self.ten_env.log_info("Deepgram options prepared (values omitted)")

            # Connect to websocket
            # The historical local field is named mid_opt_out. The provider's
            # query flag is mip_opt_out, sent via this SDK's addons argument
            # (LiveOptions.extra is for custom metadata, not query controls).
            result = await self.client.start(
                options,
                addons={"mip_opt_out": "true"} if self.config.mid_opt_out else None,
            )
            if not result:
                self.ten_env.log_error("failed to connect to deepgram")
                await self.send_asr_error(
                    ModuleError(
                        module=MODULE_NAME_ASR,
                        code=ModuleErrorCode.NON_FATAL_ERROR.value,
                        message="failed to connect to deepgram",
                    )
                )
                asyncio.create_task(self._handle_reconnect())
            else:
                self.ten_env.log_info("start_connection completed")

        except Exception as e:
            self.ten_env.log_error(
                f"KEYPOINT start_connection failed: {type(e).__name__}"
            )
            await self.send_asr_error(
                ModuleError(
                    module=MODULE_NAME_ASR,
                    code=ModuleErrorCode.FATAL_ERROR.value,
                    message=f"ASR connection failed: {type(e).__name__}",
                ),
            )

    @override
    async def finalize(self, session_id: str | None) -> None:
        assert self.config is not None

        self.last_finalize_timestamp = int(datetime.now().timestamp() * 1000)
        self.ten_env.log_info(
            f"vendor_cmd: finalize start at {self.last_finalize_timestamp}",
            category=LOG_CATEGORY_VENDOR,
        )
        await self._handle_finalize_api()

    async def _register_deepgram_event_handlers(self):
        """Register event handlers for Deepgram WebSocket client."""
        assert self.client is not None
        self.client.on(
            LiveTranscriptionEvents.Open, self._deepgram_event_handler_on_open
        )
        self.client.on(
            LiveTranscriptionEvents.Close, self._deepgram_event_handler_on_close
        )
        self.client.on(
            LiveTranscriptionEvents.Transcript,
            self._deepgram_event_handler_on_transcript,
        )
        self.client.on(
            LiveTranscriptionEvents.Error, self._deepgram_event_handler_on_error
        )

    async def _handle_asr_result(
        self,
        text: str,
        final: bool,
        start_ms: int = 0,
        duration_ms: int = 0,
        language: str = "",
    ):
        """Handle the ASR result from Deepgram ASR."""
        assert self.config is not None

        if final:
            await self._finalize_end()

        asr_result = ASRResult(
            text=text,
            final=final,
            start_ms=start_ms,
            duration_ms=duration_ms,
            language=language,
            words=[],
        )
        await self.send_asr_result(asr_result)

    async def _deepgram_event_handler_on_open(self, _, event):
        """Handle the open event from Deepgram."""
        self.ten_env.log_info(
            "vendor_status_changed: on_open",
            category=LOG_CATEGORY_VENDOR,
        )
        self.sent_user_audio_duration_ms_before_last_reset += (
            self.audio_timeline.get_total_user_audio_duration()
        )
        self.audio_timeline.reset()
        self.connected = True

        # Notify reconnect manager that connection is successful
        if self.reconnect_manager:
            self.reconnect_manager.mark_connection_successful()

    async def _deepgram_event_handler_on_close(self, *args, **kwargs):
        """Handle the close event from Deepgram."""
        self.ten_env.log_info(
            "vendor_status_changed: on_close",
            category=LOG_CATEGORY_VENDOR,
        )
        self.connected = False

        if not self.stopped:
            self.ten_env.log_warn(
                "Deepgram connection closed unexpectedly. Reconnecting..."
            )
            await self._handle_reconnect()

    async def _deepgram_event_handler_on_transcript(self, _, result):
        """Handle the transcript event from Deepgram."""
        assert self.config is not None

        try:
            sentence = result.channel.alternatives[0].transcript

            if not sentence:
                return

            start_ms = int(
                result.start * 1000
            )  # convert seconds to milliseconds
            duration_ms = int(
                result.duration * 1000
            )  # convert seconds to milliseconds
            actual_start_ms = int(
                self.audio_timeline.get_audio_duration_before_time(start_ms)
                + self.sent_user_audio_duration_ms_before_last_reset
            )
            is_final = result.is_final
            language = self.config.language

            self.ten_env.log_debug(
                f"deepgram transcript received: chars={len(sentence)}, is_final={bool(is_final)}"
            )

            await self._handle_asr_result(
                sentence,
                final=is_final,
                start_ms=actual_start_ms,
                duration_ms=duration_ms,
                language=language,
            )

        except Exception as e:
            self.ten_env.log_error(f"Error processing transcript: {type(e).__name__}")

    async def _deepgram_event_handler_on_error(self, _, error):
        """Handle the error event from Deepgram."""
        # Provider error text may echo audio transcripts, headers, or config.
        # Retain only numeric codes, never error.to_json() or error.message.
        raw_code = getattr(error, "code", None)
        known_codes = {
            "INVALID_AUTH", "INSUFFICIENT_PERMISSIONS", "TOO_MANY_REQUESTS",
            "INVALID_QUERY_PARAMETER", "INVALID_JSON", "NET-0000", "NET-0001",
        }
        code = (
            str(raw_code) if type(raw_code) is int
            else raw_code if type(raw_code) is str and raw_code in known_codes
            else "unknown"
        )
        self.ten_env.log_error(
            f"Deepgram vendor_error: code={code}",
            category=LOG_CATEGORY_VENDOR,
        )

        await self.send_asr_error(
            ModuleError(
                module=MODULE_NAME_ASR,
                code=ModuleErrorCode.NON_FATAL_ERROR.value,
                message=f"Deepgram ASR error: code={code}",
            ),
            ModuleErrorVendorInfo(
                vendor=self.vendor(),
                code=code,
                message="Deepgram ASR provider error (details omitted)",
            ),
        )

    async def _handle_finalize_api(self):
        """Handle finalize with api mode."""
        assert self.config is not None

        if self.client is None:
            _ = self.ten_env.log_debug("finalize api: client is not connected")
            return

        await self.client.finalize()
        self.ten_env.log_info(
            "vendor_cmd: finalize api completed",
            category=LOG_CATEGORY_VENDOR,
        )

    async def _handle_reconnect(self):
        """
        Handle a single reconnection attempt using the ReconnectManager.
        Connection success is determined by the _deepgram_event_handler_on_open callback.

        This method should be called repeatedly (e.g., after connection closed events)
        until either connection succeeds or max attempts are reached.
        """
        if not self.reconnect_manager:
            self.ten_env.log_error("ReconnectManager not initialized")
            return

        # Check if we can still retry
        if not self.reconnect_manager.can_retry():
            self.ten_env.log_warn("No more reconnection attempts allowed")
            await self.send_asr_error(
                ModuleError(
                    module=MODULE_NAME_ASR,
                    code=ModuleErrorCode.FATAL_ERROR.value,
                    message="No more reconnection attempts allowed",
                )
            )
            return

        # Attempt a single reconnection
        success = await self.reconnect_manager.handle_reconnect(
            connection_func=self.start_connection,
            error_handler=self.send_asr_error,
        )

        if success:
            self.ten_env.log_debug(
                "Reconnection attempt initiated successfully"
            )
        else:
            info = self.reconnect_manager.get_attempts_info()
            self.ten_env.log_debug(
                f"Reconnection attempt failed. Status: {info}"
            )

    async def _finalize_end(self) -> None:
        """Handle finalize end logic."""
        if self.last_finalize_timestamp != 0:
            timestamp = int(datetime.now().timestamp() * 1000)
            latency = timestamp - self.last_finalize_timestamp
            self.ten_env.log_debug(
                f"KEYPOINT finalize end at {timestamp}, counter: {latency}"
            )
            self.last_finalize_timestamp = 0
            await self.send_asr_finalize_end()

    async def stop_connection(self) -> None:
        """Stop the Deepgram connection."""
        try:
            if self.client:
                await self.client.finish()
                self.client = None
                self.connected = False
                self.ten_env.log_info("deepgram connection stopped")
        except Exception as e:
            self.ten_env.log_error(f"Error stopping deepgram connection: {type(e).__name__}")

    @override
    def is_connected(self) -> bool:
        return self.connected and self.client is not None

    @override
    def buffer_strategy(self) -> ASRBufferConfig:
        return ASRBufferConfigModeDiscard()

    @override
    def input_audio_sample_rate(self) -> int:
        assert self.config is not None
        return self.config.sample_rate

    @override
    async def send_audio(
        self, frame: AudioFrame, session_id: str | None
    ) -> bool:
        assert self.config is not None
        assert self.client is not None

        buf = frame.lock_buf()
        if self.audio_dumper:
            await self.audio_dumper.push_bytes(bytes(buf))
        self.audio_timeline.add_user_audio(
            int(len(buf) / (self.config.sample_rate / 1000 * 2))
        )
        await self.client.send(bytes(buf))
        frame.unlock_buf(buf)

        return True

"""Offline, synthetic voice-path checks. No credentials, network, or RTC.

The AST loader executes the production method bodies with lightweight boundary
fakes so this suite also runs before TEN's native/SDK dependencies are installed.
It is not a substitute for a provider/account integration smoke test.
"""
import ast
import asyncio
import base64
from collections import defaultdict
from datetime import datetime
import importlib.util
import json
import logging
from pathlib import Path
import subprocess
import sys
import types
import unittest
from unittest.mock import AsyncMock

HERE = Path(__file__).resolve().parent
EXT = HERE.parents[1] / "ten_packages/extension"
MAIN = HERE / "tenapp/ten_packages/extension/main_python"
FAKE_TEXT = "SYNTHETIC_PRIVATE_CONVERSATION_429"
FAKE_KEY = "FAKE_PROVIDER_CREDENTIAL_903"


class Record:
    def __init__(self, **kwargs):
        self.__dict__.update(kwargs)


class Env:
    def __init__(self):
        self.logs = []

    def __getattr__(self, name):
        if name.startswith("log_"):
            return lambda message, **kw: self.logs.append((name, message, kw))
        raise AttributeError(name)


def load_methods(path, cls_name, names, **globals_):
    """Compile unchanged production method bodies, replacing import boundaries."""
    tree = ast.parse(path.read_text())
    cls = next(n for n in tree.body if isinstance(n, ast.ClassDef) and n.name == cls_name)
    methods = [n for n in cls.body if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)) and n.name in names]
    for node in methods:
        node.decorator_list = []
    module = ast.Module(body=[ast.ImportFrom(module="__future__", names=[ast.alias(name="annotations")], level=0), *methods], type_ignores=[])
    ast.fix_missing_locations(module)
    ns = {
        "asyncio": asyncio, "json": json, "base64": base64,
        "datetime": datetime, "time": __import__("time"),
        "LOG_CATEGORY_VENDOR": "vendor", "LOG_CATEGORY_KEY_POINT": "key_point",
        "MODULE_NAME_ASR": "asr", "ModuleError": Record,
        "ModuleErrorVendorInfo": Record, "ASRResult": Record,
        "ModuleErrorCode": Record(NON_FATAL_ERROR=Record(value=1), FATAL_ERROR=Record(value=2)),
        "ModuleType": Record(TTS="tts"),
        **globals_,
    }
    exec(compile(module, str(path), "exec"), ns)
    return {name: ns[name] for name in names}


class VoicePrivacyTests(unittest.IsolatedAsyncioTestCase):
    def assert_private(self, env, *extras):
        output = repr(env.logs)
        for text in (FAKE_TEXT, FAKE_KEY, *extras):
            self.assertNotIn(text, output)

    async def test_main_preserves_tts_and_display_payloads(self):
        send = AsyncMock()
        methods = load_methods(MAIN / "extension.py", "MainControlExtension",
                               ["_send_transcript", "_send_to_tts"], _send_data=send)
        env = Env()
        instance = Record(ten_env=env, turn_id=4, _current_metadata=lambda: {"turn_id": 4})
        await methods["_send_transcript"](instance, "user", FAKE_TEXT, True, 100)
        await methods["_send_to_tts"](instance, FAKE_TEXT, True)
        self.assertEqual(send.call_args_list[0].args[3]["text"], FAKE_TEXT)
        self.assertEqual(send.call_args_list[1].args[3]["text"], FAKE_TEXT)
        self.assertTrue(send.call_args_list[1].args[3]["text_input_end"])
        self.assert_private(env)

    async def test_asr_interim_final_and_error_are_private(self):
        methods = load_methods(EXT / "deepgram_asr_python/extension.py", "DeepgramASRExtension",
                               ["_deepgram_event_handler_on_transcript",
                                "_handle_asr_result", "_deepgram_event_handler_on_error", "vendor"])
        env = Env()
        instance = Record(ten_env=env, config=Record(language="en-US"),
                          audio_timeline=Record(get_audio_duration_before_time=lambda n: n),
                          sent_user_audio_duration_ms_before_last_reset=0,
                          _finalize_end=AsyncMock(), send_asr_result=AsyncMock(),
                          send_asr_error=AsyncMock())
        instance._handle_asr_result = types.MethodType(methods["_handle_asr_result"], instance)
        instance.vendor = types.MethodType(methods["vendor"], instance)
        for final in (False, True):
            result = Record(channel=Record(alternatives=[Record(transcript=FAKE_TEXT)]),
                            start=0.2, duration=0.5, is_final=final)
            await methods["_deepgram_event_handler_on_transcript"](instance, None, result)
            actual = instance.send_asr_result.call_args.args[0]
            self.assertEqual((actual.text, actual.final, actual.duration_ms), (FAKE_TEXT, final, 500))
        instance._finalize_end.assert_awaited_once()
        for code in (401, "INVALID_AUTH", FAKE_KEY):
            error = Record(code=code, message=FAKE_TEXT, to_json=lambda: FAKE_KEY)
            await methods["_deepgram_event_handler_on_error"](instance, None, error)
        self.assertIn("401", repr(env.logs))
        self.assertIn("INVALID_AUTH", repr(env.logs))
        self.assert_private(env)
        self.assertNotIn(FAKE_KEY, repr(instance.send_asr_error.call_args))
        self.assertNotIn(FAKE_TEXT, repr(instance.send_asr_error.call_args))
        # Malformed provider objects do not stringify their contents.
        await methods["_deepgram_event_handler_on_transcript"](instance, None, Record())
        self.assertIn("AttributeError", repr(env.logs))

    async def test_deepgram_opt_out_is_a_real_query_addon(self):
        start = AsyncMock(return_value=True)
        client = Record(start=start)
        fake_deepgram = Record(AsyncListenWebSocketClient=lambda **kw: client)
        methods = load_methods(EXT / "deepgram_asr_python/extension.py", "DeepgramASRExtension",
                               ["start_connection"], deepgram=fake_deepgram,
                               DeepgramClientOptions=Record, LiveOptions=Record)
        config = Record(url="wss://synthetic.invalid", key=FAKE_KEY, api_key="",
                        hotwords=[], language="en-US", model="fake", encoding="linear16",
                        interim_results=True, punctuate=True, mid_opt_out=True,
                        advanced_params_json="")
        env = Env()
        obj = Record(config=config, ten_env=env, audio_dumper=None,
                     stop_connection=AsyncMock(), _register_deepgram_event_handlers=AsyncMock(),
                     input_audio_sample_rate=lambda: 16000, input_audio_channels=lambda: 1,
                     send_asr_error=AsyncMock())
        await methods["start_connection"](obj)
        self.assertEqual(start.call_args.kwargs["addons"], {"mip_opt_out": "true"})
        self.assertNotIn("extra", start.call_args.args[0].__dict__)
        self.assert_private(env)

    async def test_tts_request_and_duplicate_keep_content_out_of_logs(self):
        methods = load_methods(EXT / "elevenlabs_tts2_python/extension.py", "ElevenLabsTTS2Extension",
                               ["request_tts"], ModuleVendorException=type("ModuleVendorException", (Exception,), {}))
        env = Env()
        send_text = AsyncMock()
        obj = Record(ten_env=env, config=Record(dump=False), completed_request_ids=set(),
                     current_request_id=None, client=Record(send_text=send_text,
                     synthesizer=Record(send_text_in_connection=False)),
                     send_tts_error=AsyncMock(), request_states={})
        text = Record(text=FAKE_TEXT, text_input_end=True, request_id=FAKE_KEY)
        await methods["request_tts"](obj, text)
        await methods["request_tts"](obj, text)
        send_text.assert_awaited_once_with(text)
        self.assert_private(env)
        self.assertIn("already been completed", repr(env.logs))
        obj.completed_request_ids.clear()
        send_text.side_effect = ValueError(FAKE_TEXT + FAKE_KEY)
        await methods["request_tts"](obj, text)
        self.assertIn("ValueError", repr(env.logs))
        self.assert_private(env)
        self.assertNotIn(FAKE_TEXT, obj.send_tts_error.call_args.kwargs["error"].message)

    async def test_tts_websocket_text_and_audio_round_trip(self):
        methods = load_methods(EXT / "elevenlabs_tts2_python/elevenlabs_tts.py",
                               "ElevenLabsTTS2Synthesizer", ["_receive_loop", "_send_loop"],
                               ModuleVendorException=type("ModuleVendorException", (Exception,), {}))
        env = Env()
        queue = asyncio.Queue()
        await queue.put(Record(text=FAKE_TEXT, text_input_end=True, request_id=FAKE_KEY))
        obj = Record(ten_env=env, text_input_queue=queue, _session_closing=False,
                     config=Record(params={"key": FAKE_KEY}), cur_request_id="",
                     request_start_ts=None, send_text_in_connection=False,
                     _receive_ready_event=asyncio.Event(), receive_count=0,
                     response_msgs=asyncio.Queue(), error_callback=AsyncMock())
        ws = Record(send=AsyncMock(), recv=AsyncMock(side_effect=[
            json.dumps({"alignment": {"chars": list(FAKE_TEXT)}, "audio": base64.b64encode(b"fake-pcm").decode()}),
            json.dumps({"isFinal": True}),
        ]))
        await methods["_send_loop"](obj, ws)
        sent = [json.loads(c.args[0]) for c in ws.send.call_args_list]
        self.assertIn({"text": FAKE_TEXT}, sent)
        self.assertEqual(sent[-1], {"text": ""})
        await methods["_receive_loop"](obj, ws)
        pcm, final, alignment, latency = await obj.response_msgs.get()
        self.assertEqual((pcm, alignment), (b"fake-pcm", FAKE_TEXT))
        self.assert_private(env)
        ws.recv = AsyncMock(side_effect=[
            json.dumps({"error": FAKE_TEXT + FAKE_KEY, "code": 1008}),
            json.dumps({"isFinal": True}),
        ])
        await methods["_receive_loop"](obj, ws)
        self.assertIn("1008", repr(env.logs))
        self.assert_private(env)
        error = obj.error_callback.call_args.args[1]
        self.assertNotIn(FAKE_TEXT, error.message)
        self.assertNotIn(FAKE_KEY, error.vendor_info.message)

    async def test_llm_context_is_preserved_not_logged(self):
        methods = load_methods(MAIN / "agent/llm_exec.py", "LLMExec",
                               ["_queue_context"])
        env = Env()
        obj = Record(contexts=[])
        message = Record(content=FAKE_TEXT, credential=FAKE_KEY)
        await methods["_queue_context"](obj, env, message)
        self.assertIs(obj.contexts[0], message)
        self.assert_private(env)

    async def test_openai_reply_preserved_store_disabled_and_errors_private(self):
        class Parser:
            state = "NORMAL"

            def process_by_reasoning_content(self, value):
                return False

        methods = load_methods(
            EXT / "openai_llm2_python/openai.py", "OpenAIChatGPT", ["_get_chat_completions"],
            LLMMessageContent=Record, LLMMessageFunctionCall=Record,
            LLMMessageFunctionCallOutput=Record, TextContent=Record, ImageContent=Record,
            LLMResponseMessageDelta=Record, LLMResponseMessageDone=Record,
            ThinkParser=Parser, ReasoningMode=Record(ModeV1=1), defaultdict=defaultdict,
        )
        class Stream:
            close = AsyncMock()

            def __aiter__(self):
                async def chunks():
                    yield Record(id="synthetic", created=1, choices=[
                        Record(delta=Record(content=FAKE_TEXT, tool_calls=None))
                    ])
                return chunks()

        env = Env()
        stream = Stream()
        create = AsyncMock(return_value=stream)
        config = Record(
            prompt="synthetic prompt", model="fake-model", max_tokens=64,
            temperature=0.5, top_p=1, presence_penalty=0, frequency_penalty=0,
            seed=1, is_black_list_params=lambda key: False,
        )
        obj = Record(ten_env=env, config=config,
                     client=Record(chat=Record(completions=Record(create=create))))
        request = Record(messages=[Record(role="user", content=FAKE_TEXT)],
                         prompt=None, tools=[], streaming=True,
                         parameters={"store": True})
        replies = [r async for r in methods["_get_chat_completions"](obj, request)]
        self.assertEqual(replies[-1].content, FAKE_TEXT)
        self.assertEqual(create.call_args.kwargs["messages"][1]["content"], FAKE_TEXT)
        self.assertIs(create.call_args.kwargs["store"], False)
        stream.close.assert_awaited_once()
        self.assert_private(env)
        error = ValueError(FAKE_TEXT + FAKE_KEY)
        error.status_code = 401
        create.side_effect = error
        with self.assertRaisesRegex(RuntimeError, "details omitted"):
            _ = [r async for r in methods["_get_chat_completions"](obj, request)]
        self.assertIn("status=401", repr(env.logs))
        self.assertIn("ValueError", repr(env.logs))
        self.assert_private(env)


class RuntimePrivacyTests(unittest.TestCase):
    def test_python_sdk_logging_never_formats_sensitive_values(self):
        path = HERE / "tenapp/scripts/privacy/sitecustomize.py"
        old = logging.getLogRecordFactory()
        try:
            spec = importlib.util.spec_from_file_location("privacy_test_bootstrap", path)
            module = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(module)

            class DoNotFormat:
                def __str__(self):
                    raise AssertionError("original payload must not be formatted")

            record = logging.getLogger("httpx").makeRecord(
                "httpx", logging.ERROR, __file__, 42, "%s", (DoNotFormat(),),
                (ValueError, ValueError(FAKE_KEY), None), None,
                sinfo=FAKE_TEXT,
            )
            rendered = logging.Formatter("%(name)s %(message)s").format(record)
            self.assertIn("ValueError", rendered)
            self.assertNotIn(FAKE_KEY, rendered)
            self.assertNotIn(FAKE_TEXT, rendered)
            self.assertIsNone(record.exc_info)
            self.assertIsNone(record.stack_info)
        finally:
            logging.setLogRecordFactory(old)

    def test_startup_hook_is_loaded_in_new_interpreter(self):
        # Build a synthetic environment, not a copy of real provider secrets.
        bootstrap = HERE / "tenapp/scripts/privacy"
        result = subprocess.run(
            [sys.executable, "-c", "import logging; logging.warning('FAKE_PRIVATE_STARTUP')"],
            env={"PYTHONPATH": str(bootstrap)}, capture_output=True, text=True, check=True,
        )
        self.assertIn("Python diagnostic", result.stderr)
        self.assertNotIn("FAKE_PRIVATE_STARTUP", result.stderr)

    def test_voice_config_is_warning_only_and_dump_off(self):
        config = json.loads((HERE / "tenapp/property.json").read_text())
        self.assertEqual(config["ten"]["log"]["handlers"][0]["matchers"][0]["level"], "warn")
        graph = config["ten"]["predefined_graphs"][0]["graph"]
        nodes = {n["name"]: n for n in graph["nodes"]}
        self.assertFalse(nodes["tts"]["property"]["dump"])
        self.assertFalse(nodes["stt"]["property"]["dump"])
        self.assertTrue(nodes["stt"]["property"]["mid_opt_out"])

    def test_log_sinks_have_no_raw_payload_interpolations(self):
        paths = [
            *MAIN.rglob("*.py"),
            EXT / "deepgram_asr_python/extension.py",
            EXT / "elevenlabs_tts2_python/extension.py",
            EXT / "elevenlabs_tts2_python/elevenlabs_tts.py",
            EXT / "openai_llm2_python/openai.py",
            EXT / "openai_llm2_python/extension.py",
        ]
        forbidden = {"text", "content", "arguments", "message", "params", "uri",
                     "request_id", "current_request_id", "config", "sentence",
                     "response_json", "new_message", "llm_output", "tool_result",
                     "result_content", "result_json", "e", "err", "exp"}
        for path in paths:
            tree = ast.parse(path.read_text())
            for call in ast.walk(tree):
                if not (isinstance(call, ast.Call) and isinstance(call.func, ast.Attribute)
                        and call.func.attr.startswith("log_")):
                    continue
                for value in ast.walk(call):
                    if isinstance(value, ast.FormattedValue):
                        # Count/type/boolean measurements are safe; raw fields aren't.
                        raw = value.value
                        if isinstance(raw, ast.Name):
                            self.assertNotIn(raw.id, forbidden, f"{path}:{call.lineno}")
                        if isinstance(raw, ast.Attribute):
                            self.assertNotIn(raw.attr, forbidden, f"{path}:{call.lineno}")
                        self.assertNotIn("traceback", ast.unparse(raw))


if __name__ == "__main__":
    unittest.main()

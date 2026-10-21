#
#
# Agora Real Time Engagement
# Created by Wei Hu in 2024-08.
# Copyright (c) 2024 Agora IO. All rights reserved.
#
#
from collections import defaultdict
import asyncio
from contextlib import aclosing
from dataclasses import dataclass, field
from enum import Enum
import json
import random
import uuid
from typing import AsyncGenerator, List
from pydantic import BaseModel
import requests
from openai import AsyncOpenAI, AsyncStream
from openai.types.chat import ChatCompletionChunk

from ten_ai_base.struct import (
    ImageContent,
    LLMMessageContent,
    LLMMessageFunctionCall,
    LLMMessageFunctionCallOutput,
    LLMRequest,
    LLMResponse,
    LLMResponseMessageDelta,
    LLMResponseMessageDone,
    LLMResponseReasoningDelta,
    LLMResponseReasoningDone,
    LLMResponseToolCall,
    TextContent,
)
from ten_ai_base.types import LLMToolMetadata
from ten_runtime.async_ten_env import AsyncTenEnv
from .security import SecurityGuard, BLOCK_MESSAGE, PAUSE_MESSAGE
from .memory_store import MemoryStore, context_block
from .knowledge import retrieve_knowledge


@dataclass
class OpenAILLM2Config(BaseModel):
    api_key: str = ""
    base_url: str = "https://api.openai.com/v1"
    model: str = (
        "gpt-4o"  # Adjust this to match the equivalent of `openai.GPT4o` in the Python library
    )
    proxy_url: str = ""
    temperature: float = 0.7
    top_p: float = 1.0
    presence_penalty: float = 0.0
    frequency_penalty: float = 0.0
    max_tokens: int = 4096
    seed: int = random.randint(0, 1000000)
    prompt: str = "You are a helpful assistant."
    security_enabled: bool = False
    companion_enabled: bool = False
    black_list_params: List[str] = field(
        default_factory=lambda: ["messages", "tools", "stream", "n", "model"]
    )

    def is_black_list_params(self, key: str) -> bool:
        return key in self.black_list_params


class ReasoningMode(str, Enum):
    ModeV1 = "v1"


class ThinkParser:
    def __init__(self):
        self.state = "NORMAL"  # States: 'NORMAL', 'THINK'
        self.think_content = ""
        self.content = ""
        self.think_delta = ""

    def process(self, new_chars):
        if new_chars == "<think>":
            self.state = "THINK"
            self.think_delta = ""
            return True
        elif new_chars == "</think>":
            self.state = "NORMAL"
            self.think_delta = ""
            return True
        else:
            if self.state == "THINK":
                self.think_content += new_chars
                self.think_delta = new_chars
        return False

    def process_by_reasoning_content(self, reasoning_content):
        state_changed = False
        if reasoning_content:
            if self.state == "NORMAL":
                self.state = "THINK"
                state_changed = True
            self.think_content += reasoning_content
            self.think_delta = reasoning_content
        elif self.state == "THINK":
            self.state = "NORMAL"
            self.think_delta = ""
            state_changed = True
        return state_changed


class OpenAIChatGPT:
    client = None

    def __init__(self, ten_env: AsyncTenEnv, config: OpenAILLM2Config):
        self.config = config
        self.ten_env = ten_env
        ten_env.log_info("OpenAIChatGPT initialized (credentials omitted)")
        self.guard = SecurityGuard() if config.security_enabled else None
        if self.guard is not None:
            self.guard.event("worker", "ready", "guard_initialized")
        self.client = AsyncOpenAI(
            api_key=config.api_key,
            base_url=config.base_url,
            default_headers={
                "api-key": config.api_key,
                "Authorization": f"Bearer {config.api_key}",
            },
        )
        self.session = requests.Session()
        if config.proxy_url:
            proxies = {
                "http": config.proxy_url,
                "https": config.proxy_url,
            }
            ten_env.log_info("Using configured HTTP proxy")
            self.session.proxies.update(proxies)
        self.client.session = self.session

    def _convert_tools_to_dict(self, tool: LLMToolMetadata):
        json_dict = {
            "type": "function",
            "function": {
                "name": tool.name,
                "description": tool.description,
                "parameters": {
                    "type": "object",
                    "properties": {},
                    "required": [],
                    "additionalProperties": False,
                },
            },
            "strict": True,
        }

        for param in tool.parameters:
            json_dict["function"]["parameters"]["properties"][param.name] = {
                "type": param.type,
                "description": param.description,
            }
            if param.required:
                json_dict["function"]["parameters"]["required"].append(
                    param.name
                )
            if param.type == "array":
                json_dict["function"]["parameters"]["properties"][param.name][
                    "items"
                ] = param.items

        return json_dict

    async def get_chat_completions(
        self, request_input: LLMRequest
    ) -> AsyncGenerator[LLMResponse, None]:
        if self.guard is None:
            async for event in self._get_chat_completions(request_input):
                yield event
            return

        rule = None
        stage = "input"
        try:
            rule = self.guard.begin()
            messages = list(request_input.messages)[-24:]
            last_user = max(
                (i for i, item in enumerate(messages)
                 if isinstance(item, LLMMessageContent) and item.role == "user"),
                default=-1,
            )
            for i, message in enumerate(messages):
                if rule:
                    break
                text = None
                if isinstance(message, LLMMessageContent):
                    if message.role not in ("user", "assistant"):
                        rule = "untrusted_role"
                        break
                    if message.role == "user":
                        if isinstance(message.content, list) and any(
                            isinstance(item, ImageContent) for item in message.content
                        ):
                            rule = "unsupported_image_input"
                            break
                        text = message.content if isinstance(message.content, str) else "\n".join(
                            item.text for item in message.content if isinstance(item, TextContent)
                        )
                elif isinstance(message, LLMMessageFunctionCallOutput):
                    text = str(message.output)
                if text is not None:
                    detected = self.guard.check_text(text)
                    if detected and i < last_user:
                        # Do not let a blocked historical turn poison every later request.
                        if isinstance(message, LLMMessageContent):
                            messages[i] = message.model_copy(update={"content": "[Earlier request withheld by security policy.]"})
                        else:
                            messages[i] = message.model_copy(update={"output": "[Tool output withheld by security policy.]"})
                    elif detected:
                        rule = detected
            if not rule:
                prompt = self.config.prompt
                if getattr(self.config, "companion_enabled", False):
                    query = next((
                        message.content for message in reversed(messages)
                        if isinstance(message, LLMMessageContent)
                        and message.role == "user" and isinstance(message.content, str)
                    ), "")
                    references = retrieve_knowledge(query)
                    try:
                        notes = await asyncio.wait_for(
                            MemoryStore().search(self.client, query), timeout=8
                        )
                        notes = [note for note in notes if not self.guard.check_text(note["text"])]
                    except Exception:
                        notes = []
                        prompt += "\nPersonal memory recall is unavailable; do not claim to recall saved notes."
                        self.ten_env.log_info("Personal memory recall unavailable (details omitted)")
                    prompt += context_block(notes, references)
                if self.guard.paused():
                    self.guard.event("input", "blocked", "paused")
                    response_id = str(uuid.uuid4())
                    yield LLMResponseMessageDelta(
                        response_id=response_id, role="assistant",
                        content=PAUSE_MESSAGE, delta=PAUSE_MESSAGE,
                    )
                    yield LLMResponseMessageDone(
                        response_id=response_id, role="assistant", content=PAUSE_MESSAGE,
                    )
                    return
                # User- or request-supplied prompts/parameters cannot override policy.
                protected = request_input.model_copy(update={
                    "messages": messages[-24:], "prompt": prompt,
                    "tools": [], "parameters": {}, "streaming": True,
                })
                buffered = []
                output_size = 0
                stage = "output"
                async with aclosing(self._get_chat_completions(protected)) as stream:
                    async for event in stream:
                        if self.guard.paused():
                            rule = "paused"
                            break
                        if isinstance(event, LLMResponseToolCall):
                            rule = self.guard.check_tool(event.name, event.arguments)
                        if rule:
                            break
                        output_size += len(getattr(event, "delta", "") or "")
                        if output_size > 32000 or len(buffered) >= 2048:
                            rule = "output_limit"
                            break
                        buffered.append(event)
                if not rule:
                    # Scan complete output before releasing any text/audio or tools.
                    text = "".join(
                        event.delta or "" for event in buffered
                        if isinstance(event, (LLMResponseMessageDelta, LLMResponseReasoningDelta))
                    )
                    rule = self.guard.check_text(text, "output")
                    for event in buffered:
                        content = getattr(event, "content", None)
                        if content and not rule:
                            rule = self.guard.check_text(content, "output")
                if not rule and self.guard.paused():
                    rule = "paused"
                if not rule:
                    self.guard.event("response", "allowed", "checks_passed")
                    for event in buffered:
                        if self.guard.paused():
                            # Previously queued speech cannot be recalled.
                            return
                        yield event
                    return
            self.guard.event(stage, "blocked", rule)
        except Exception:
            # Do not expose model errors, prompts, credentials, or arguments.
            rule = "guard_unavailable"
            self.ten_env.log_error("Protected completion failed closed; details omitted")

        response_id = str(uuid.uuid4())
        text = PAUSE_MESSAGE if rule == "paused" else BLOCK_MESSAGE
        yield LLMResponseMessageDelta(
            response_id=response_id, role="assistant", content=text, delta=text
        )
        yield LLMResponseMessageDone(
            response_id=response_id, role="assistant", content=text
        )

    async def _get_chat_completions(
        self, request_input: LLMRequest
    ) -> AsyncGenerator[LLMResponse, None]:
        messages = request_input.messages
        tools = None
        parsed_messages = []
        system_prompt = request_input.prompt or self.config.prompt

        self.ten_env.log_info(
            f"get_chat_completions: {len(messages)} messages, streaming: {request_input.streaming}"
        )

        for message in messages:
            match message:
                case LLMMessageContent():
                    role = message.role
                    content = message.content
                    if isinstance(content, str):
                        parsed_messages.append(
                            {"role": role, "content": content}
                        )
                    elif isinstance(content, list):
                        # Assuming content is a list of objects
                        content_items = []
                        for item in content:
                            match item:
                                case TextContent():
                                    content_items.append(
                                        {"type": "text", "text": item.text}
                                    )
                                case ImageContent():
                                    content_items.append(
                                        {
                                            "type": "image_url",
                                            "image_url": {
                                                "url": item.image_url.url
                                            },
                                        }
                                    )
                        parsed_messages.append(
                            {"role": role, "content": content_items}
                        )
                case LLMMessageFunctionCall():
                    # Handle function call messages
                    parsed_messages.append(
                        {
                            "role": "assistant",
                            "tool_calls": [
                                {
                                    "id": message.call_id,
                                    "type": "function",
                                    "function": {
                                        "name": message.name,
                                        "arguments": message.arguments,
                                    },
                                }
                            ],
                        }
                    )
                case LLMMessageFunctionCallOutput():
                    # Handle function call output messages
                    parsed_messages.append(
                        {
                            "role": "tool",
                            "tool_call_id": message.call_id,
                            "content": message.output,
                        }
                    )

        for tool in request_input.tools or []:
            if tools is None:
                tools = []
            tools.append(self._convert_tools_to_dict(tool))

        # Check if model is a reasoning model (gpt-5.x) that requires different parameters
        is_reasoning_model = (
            self.config.model and self.config.model.lower().startswith("gpt-5")
        )

        # Build request
        req = {
            "model": self.config.model,
            "messages": [
                {"role": "system", "content": system_prompt},
                *parsed_messages,
            ],
            "tools": tools,
            "stream": request_input.streaming,
            "n": 1,  # Assuming single response for now
        }

        # GPT-5.x models use max_completion_tokens and don't support sampling parameters
        if is_reasoning_model:
            req["max_completion_tokens"] = self.config.max_tokens
        else:
            req["max_tokens"] = self.config.max_tokens
            req["temperature"] = self.config.temperature
            req["top_p"] = self.config.top_p
            req["presence_penalty"] = self.config.presence_penalty
            req["frequency_penalty"] = self.config.frequency_penalty
            req["seed"] = self.config.seed

        # Add additional parameters if they are not in the black list
        for key, value in (request_input.parameters or {}).items():
            # Check if it's a valid option and not in black list
            if not self.config.is_black_list_params(key):
                req[key] = value

        self.ten_env.log_info("Requesting chat completion (content omitted)")

        response = None
        try:
            response: AsyncStream[ChatCompletionChunk] = (
                await self.client.chat.completions.create(**req)
            )

            full_content = ""
            # Check for tool calls
            tool_calls_dict = defaultdict(
                lambda: {
                    "id": None,
                    "function": {"arguments": "", "name": None},
                    "type": None,
                }
            )

            # Example usage
            parser = ThinkParser()
            reasoning_mode = None

            last_chat_completion: ChatCompletionChunk | None = None

            async for chat_completion in response:
                if chat_completion is None or len(chat_completion.choices) == 0:
                    continue
                last_chat_completion = chat_completion
                choice = chat_completion.choices[0]
                delta = choice.delta


                content = delta.content if delta and delta.content else ""
                reasoning_content = (
                    delta.reasoning_content
                    if delta
                    and hasattr(delta, "reasoning_content")
                    and delta.reasoning_content
                    else ""
                )

                if reasoning_mode is None and reasoning_content is not None:
                    reasoning_mode = ReasoningMode.ModeV1

                # Emit content update event (fire-and-forget)
                if content or reasoning_mode == ReasoningMode.ModeV1:
                    prev_state = parser.state

                    if reasoning_mode == ReasoningMode.ModeV1:
                        self.ten_env.log_debug("process_by_reasoning_content")
                        think_state_changed = (
                            parser.process_by_reasoning_content(
                                reasoning_content
                            )
                        )
                    else:
                        think_state_changed = parser.process(content)

                    if not think_state_changed:
                        if parser.state == "THINK":
                            yield LLMResponseReasoningDelta(
                                response_id=chat_completion.id,
                                role="assistant",
                                content=parser.think_content,
                                delta=parser.think_delta,
                                created=chat_completion.created,
                            )
                        elif parser.state == "NORMAL":
                            yield LLMResponseMessageDelta(
                                response_id=chat_completion.id,
                                role="assistant",
                                content=full_content + content,
                                delta=content,
                                created=chat_completion.created,
                            )

                    if prev_state == "THINK" and parser.state == "NORMAL":
                        yield LLMResponseReasoningDone(
                            response_id=chat_completion.id,
                            role="assistant",
                            content=parser.think_content,
                            created=chat_completion.created,
                        )
                        parser.think_content = ""

                full_content += content

                if delta.tool_calls:
                    try:
                        for tool_call in delta.tool_calls:
                            if tool_call.index not in tool_calls_dict:
                                tool_calls_dict[tool_call.index] = {
                                    "id": None,
                                    "function": {"arguments": "", "name": None},
                                    "type": None,
                                }

                            if tool_call.id:
                                tool_calls_dict[tool_call.index][
                                    "id"
                                ] = tool_call.id

                            # If the function name is not None, set it
                            if tool_call.function.name:
                                tool_calls_dict[tool_call.index]["function"][
                                    "name"
                                ] = tool_call.function.name

                            # Append the arguments if not None
                            if tool_call.function.arguments:
                                tool_calls_dict[tool_call.index]["function"][
                                    "arguments"
                                ] += tool_call.function.arguments

                            # If the type is not None, set it
                            if tool_call.type:
                                tool_calls_dict[tool_call.index][
                                    "type"
                                ] = tool_call.type
                    except Exception as e:
                        self.ten_env.log_error(
                            "Error processing tool call (details omitted)"
                        )

            if last_chat_completion is None:
                self.ten_env.log_info("No chat completion choices found.")
                return

            # Convert the dictionary to a list
            tool_calls_list = list(tool_calls_dict.values())

            # Emit tool calls event (fire-and-forget)
            if tool_calls_list:
                for tool_call in tool_calls_list:
                    arguements = json.loads(tool_call["function"]["arguments"])
                    yield LLMResponseToolCall(
                        response_id=last_chat_completion.id,
                        id=last_chat_completion.id,
                        tool_call_id=tool_call["id"],
                        name=tool_call["function"]["name"],
                        arguments=arguements,
                        created=last_chat_completion.created,
                    )

            # Emit content finished event after the loop completes
            yield LLMResponseMessageDone(
                response_id=last_chat_completion.id,
                role="assistant",
                content=full_content,
                created=last_chat_completion.created,
            )
        except Exception as e:
            raise RuntimeError("Chat completion failed; details omitted") from None
        finally:
            if response is not None:
                await response.close()

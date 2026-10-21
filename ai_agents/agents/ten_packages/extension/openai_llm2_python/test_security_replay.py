"""Replay boundary tests: real adapter, fake provider. Never paid requests."""
import asyncio
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import time
import types
import unittest
from unittest.mock import patch

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("security_replay", HERE / "security_replay.py")
replay = importlib.util.module_from_spec(spec)
spec.loader.exec_module(replay)
adapter = replay.load_adapter()
from openai.types.chat import ChatCompletionChunk

LIMITS = {"requests": 6, "tokens": 8192, "output_tokens": 64, "seconds": 5, "budget_cents": 10}


def report():
    return {
        "id": "fake-run", "channel": "synthetic-replay-fake", "status": "running",
        "reason": "", "limits": dict(LIMITS), "requests_attempted": 0,
        "reserved_tokens": 0, "reserved_microdollars": 0, "cases": [],
    }


class Stream:
    def __init__(self, text, hang=False, finish="stop"):
        self.parts = [text[:len(text)//2], text[len(text)//2:]]
        self.hang = hang
        self.closed = False
        self.finish = finish
        self.finished = False

    def __aiter__(self):
        return self

    async def __anext__(self):
        if self.hang:
            await asyncio.Event().wait()
        if self.parts:
            return ChatCompletionChunk(
                id="fake", created=1, model="fake", object="chat.completion.chunk",
                choices=[{"index": 0, "delta": {"content": self.parts.pop(0)}}],
            )
        if not self.finished:
            self.finished = True
            return ChatCompletionChunk(
                id="fake", created=1, model="fake", object="chat.completion.chunk",
                choices=[{"index": 0, "delta": {}, "finish_reason": self.finish}],
            )
        raise StopAsyncIteration

    async def close(self):
        self.closed = True


class ReplayTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.directory = Path(self.temp.name)
        self.report = report()
        self.streams = []
        self.clients = []
        self.requests = []
        self.text = "A safe fictional answer."
        self.hang = False
        self.finish = "stop"
        self.provider_error = False

    def tearDown(self):
        self.temp.cleanup()

    def factory(self, directory, output_tokens):
        guard = adapter.SecurityGuard(directory, secrets=[replay.FAKE_SECRET])
        client = adapter.OpenAIChatGPT(
            replay.QuietEnv(),
            adapter.OpenAILLM2Config.model_validate({
                "api_key": "fake-key-not-real", "security_enabled": True,
                "prompt": replay.SYSTEM, "max_tokens": output_tokens, "model": replay.MODEL,
            }),
            security_guard=guard,
        )
        real_sdk = client.client

        async def create(**kwargs):
            self.requests.append(kwargs)
            if self.provider_error:
                raise RuntimeError("DO_NOT_LOG_SYNTHETIC_PROVIDER_ERROR")
            stream = Stream(self.text, self.hang, self.finish)
            self.streams.append(stream)
            return stream

        client.client = types.SimpleNamespace(
            chat=types.SimpleNamespace(completions=types.SimpleNamespace(create=create)),
            close=real_sdk.close,
        )
        self.clients.append(client)
        return client, adapter

    async def run_replay(self):
        await replay.run_cases(self.report, self.directory, self.factory)
        return self.report

    async def test_real_adapter_and_provider_path_with_isolated_state(self):
        with tempfile.TemporaryDirectory() as live:
            live_guard = adapter.SecurityGuard(live, secrets=[])
            live_guard.control(True)
            before = (Path(live) / "security.sqlite3").read_bytes()
            result = await self.run_replay()
            self.assertEqual(before, (Path(live) / "security.sqlite3").read_bytes())
            self.assertTrue(live_guard.paused())
        self.assertEqual(len(result["cases"]), 6)
        self.assertEqual(result["cases"][1]["outcome"], "input_blocked")
        self.assertEqual(result["requests_attempted"], 5)
        self.assertEqual(result["cases"][0]["outcome"], "allowed")
        self.assertTrue(all(stream.closed for stream in self.streams))
        for request in self.requests:
            self.assertEqual(len(request["messages"]), 2)
            self.assertIsNone(request["tools"])
            self.assertEqual(request["max_tokens"], 64)
            self.assertEqual(request["messages"][0]["content"], replay.SYSTEM)
        saved = (self.directory / "report.json").read_text()
        self.assertNotIn(self.text, saved)
        self.assertNotIn(replay.FAKE_SECRET, saved)
        self.assertNotIn("DO_NOT_LOG", saved)

    async def test_secret_split_across_real_provider_chunks_blocked(self):
        self.text = replay.FAKE_SECRET
        result = await self.run_replay()
        self.assertEqual(result["cases"][0]["outcome"], "output_blocked")
        self.assertFalse(result["cases"][0]["fixture_violation_released"])

    async def test_semantic_violation_is_honestly_reported(self):
        self.text = replay.POLICY_MARKER
        result = await self.run_replay()
        self.assertTrue(result["cases"][0]["fixture_violation_released"])
        self.assertEqual(result["cases"][0]["outcome"], "allowed")

    async def test_refusal_is_not_misreported_as_guard_block(self):
        self.text = "I cannot share that label."
        result = await self.run_replay()
        self.assertEqual(result["cases"][2]["outcome"], "allowed")

    async def test_empty_and_truncated_replies_are_inconclusive(self):
        self.finish = "length"
        result = await self.run_replay()
        self.assertEqual(result["cases"][0]["outcome"], "inconclusive")
        self.report = report()
        self.text = ""
        self.finish = "stop"
        result = await self.run_replay()
        self.assertEqual(result["cases"][0]["outcome"], "inconclusive")

    async def test_provider_errors_not_passes_or_free_reservations(self):
        self.provider_error = True
        result = await self.run_replay()
        self.assertEqual(result["cases"][0]["outcome"], "provider_error")
        self.assertEqual(result["requests_attempted"], 5)
        self.assertGreater(result["reserved_tokens"], 0)
        self.assertNotIn("DO_NOT_LOG", json.dumps(result))

    async def test_request_cap(self):
        self.report["limits"]["requests"] = 1
        result = await self.run_replay()
        self.assertEqual(len(self.requests), 1)
        self.assertEqual(result["reason"], "request_limit")

    async def test_token_cap_reserves_before_sending(self):
        self.report["limits"]["tokens"] = 512
        result = await self.run_replay()
        self.assertEqual(len(self.requests), 0)
        self.assertEqual(result["reason"], "token_limit")
        self.assertEqual(result["cases"][0]["outcome"], "not_sent")

    async def test_cost_cap_reserves_before_sending(self):
        self.report["limits"]["budget_cents"] = 1
        result = await self.run_replay()
        self.assertEqual(len(self.requests), 0)
        self.assertEqual(result["reason"], "cost_limit")

    async def test_cancel_closes_inflight_stream(self):
        self.hang = True

        async def request_cancel():
            while not self.streams:
                await asyncio.sleep(0.01)
            (self.directory / "cancel").write_text(self.report["id"])

        await asyncio.gather(self.run_replay(), request_cancel())
        self.assertEqual(self.report["status"], "cancelled")
        self.assertTrue(self.streams[0].closed)
        self.assertEqual(self.report["requests_attempted"], 1)

    async def test_deadline_closes_inflight_stream(self):
        self.hang = True
        self.report["limits"]["seconds"] = 0.5  # test-only, public minimum remains 5
        result = await self.run_replay()
        self.assertEqual(result["reason"], "time_limit")
        self.assertEqual(result["cases"][0]["outcome"], "timeout")
        self.assertTrue(self.streams[0].closed)

    async def test_cancel_before_first_request(self):
        (self.directory / "cancel").write_text(self.report["id"])
        result = await self.run_replay()
        self.assertEqual(result["status"], "cancelled")
        self.assertEqual(len(self.clients), 0)

    async def test_spend_and_tokens_never_exceed_limits(self):
        result = await self.run_replay()
        self.assertLessEqual(result["reserved_tokens"], result["limits"]["tokens"])
        self.assertLessEqual(result["reserved_microdollars"], result["limits"]["budget_cents"] * 10000)


class ControlTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.directory = Path(self.temp.name)

    def tearDown(self):
        self.temp.cleanup()

    def test_no_approval_never_spawns_or_writes(self):
        with patch.object(replay.subprocess, "Popen") as spawn:
            for approval in (False, None, 1, "yes"):
                with self.assertRaises(replay.ReplayError):
                    replay.start(LIMITS, approval, self.directory)
            spawn.assert_not_called()
        self.assertEqual(list(self.directory.iterdir()), [])

    def test_bad_limits_rejected(self):
        for key in LIMITS:
            for bad in (True, -1, 999999, "3", None):
                with self.assertRaises(replay.ReplayError):
                    replay.validate_limits({**LIMITS, key: bad})
        with self.assertRaises(replay.ReplayError):
            replay.validate_limits({**LIMITS, "prompt": "arbitrary"})

    def test_duplicate_run_cannot_spawn(self):
        with replay.lock_file(self.directory) as lock:
            replay.fcntl.flock(lock, replay.fcntl.LOCK_EX)
            with patch.object(replay.subprocess, "Popen") as spawn:
                with self.assertRaises(replay.ReplayError):
                    replay.start(LIMITS, True, self.directory)
                spawn.assert_not_called()

    def test_status_is_free_and_dead_worker_is_interrupted(self):
        replay.save(self.directory, report())
        result = replay.status(self.directory)
        self.assertEqual(result["report"]["status"], "interrupted")

    def test_stale_cancel_cannot_affect_current_run(self):
        replay.save(self.directory, report())
        with self.assertRaises(replay.ReplayError):
            replay.cancel("old-run", self.directory)
        self.assertFalse((self.directory / "cancel").exists())

    def test_start_uses_isolated_worker_with_safe_environment(self):
        with patch.dict(replay.os.environ, {"PRIVATE_CHAT": "DO_NOT_INHERIT"}):
            with patch.object(replay.subprocess, "Popen") as spawn:
                result = replay.start(LIMITS, True, self.directory)
        self.assertNotIn("PRIVATE_CHAT", spawn.call_args.kwargs["env"])
        self.assertIn("--lock-fd", spawn.call_args.args[0])
        self.assertEqual(result["report"]["requests_attempted"], 0)
        self.assertTrue(result["report"]["channel"].startswith("synthetic-replay-"))
        self.assertEqual((self.directory / "report.json").stat().st_mode & 0o777, 0o600)

    def test_cancel_writes_only_matching_uuid(self):
        replay.save(self.directory, report())
        with replay.lock_file(self.directory) as lock:
            replay.fcntl.flock(lock, replay.fcntl.LOCK_EX)
            replay.cancel("fake-run", self.directory)
        self.assertEqual((self.directory / "cancel").read_text(), "fake-run")

    def test_setup_failure_is_explicit_error_not_success(self):
        replay.save(self.directory, report())
        with patch.object(replay, "run_cases", side_effect=RuntimeError("fake-private-error")):
            with replay.lock_file(self.directory) as lock:
                replay.worker(self.directory, replay.os.dup(lock.fileno()))
        result = replay.status(self.directory)["report"]
        self.assertEqual(result["status"], "error")
        self.assertNotIn("fake-private-error", json.dumps(result))


if __name__ == "__main__":
    unittest.main()

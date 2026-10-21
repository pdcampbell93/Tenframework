"""Isolated companion/memory tests with synthetic text and fake providers only."""
import asyncio
import json
import tempfile
import types
import unittest
from unittest.mock import patch

import companion
from memory_store import MemoryStore, context_block
from knowledge import retrieve_knowledge
from security import SecurityGuard


class FakeClient:
    def __init__(self):
        self.calls = []
        self.embeddings = types.SimpleNamespace(create=self.embed)
        self.chat = types.SimpleNamespace(completions=types.SimpleNamespace(create=self.complete))
        self.output = "A synthetic reply."

    async def embed(self, **kwargs):
        self.calls.append(("embedding", kwargs))
        vector = [1.0, 0.0] if "game" in kwargs["input"].lower() else [0.0, 1.0]
        return types.SimpleNamespace(data=[types.SimpleNamespace(embedding=vector)])

    async def complete(self, **kwargs):
        self.calls.append(("chat", kwargs))
        return types.SimpleNamespace(choices=[types.SimpleNamespace(message=types.SimpleNamespace(content=self.output))])


class CompanionTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.store = MemoryStore(self.temp.name + "/memory")
        self.guard = SecurityGuard(self.temp.name + "/guard", secrets=["SYNTHETIC_SECRET_123456789"])
        self.client = FakeClient()

    def tearDown(self):
        self.temp.cleanup()

    async def handle(self, body):
        return await companion.handle(body, self.client, self.store, self.guard)

    async def test_status_no_provider_call_or_auto_memory(self):
        response = await self.handle({})
        self.assertEqual(response["memories"], [])
        self.assertTrue(response["privacy"]["approval_required"])
        self.assertEqual(len(self.client.calls), 0)

    async def test_save_without_approval_rejected_before_embedding(self):
        with self.assertRaises(ValueError):
            await self.handle({"action": "save", "text": "I am designing a synthetic game."})
        self.assertEqual(self.client.calls, [])
        self.assertEqual(self.store.list(), [])

    async def test_approved_create_recall_edit_delete(self):
        created = await self.handle({"action": "save", "approved": True, "text": "Synthetic game uses a portal."})
        memory_id = created["memory"]["id"]
        self.assertEqual(len(self.store.list()), 1)
        result = await self.handle({"action": "search", "query": "game"})
        self.assertEqual(result["matches"][0]["id"], memory_id)
        await self.handle({"action": "save", "approved": True, "id": memory_id, "text": "Synthetic quantum circuit."})
        self.assertEqual((await self.handle({"action": "search", "query": "game"}))["matches"], [])
        self.assertEqual((await self.handle({"action": "search", "query": "quantum"}))["matches"][0]["id"], memory_id)
        await self.handle({"action": "delete", "id": memory_id})
        self.assertEqual(self.store.list(), [])
        with self.store.connect() as db:
            self.assertEqual(db.execute("SELECT count(*) FROM memories").fetchone()[0], 0)

    async def test_summary_is_not_saved(self):
        self.client.output = "Synthetic draft: prefers small game prototypes."
        result = await self.handle({"action": "summary", "messages": [{"role": "user", "content": "I prefer small game prototypes."}]})
        self.assertIn("Synthetic draft", result["draft"])
        self.assertEqual(self.store.list(), [])

    async def test_chat_retrieves_approved_notes_and_references(self):
        await self.handle({"action": "save", "approved": True, "text": "Synthetic quantum circuit."})
        result = await self.handle({"action": "chat", "messages": [{"role": "user", "content": "Explain quantum entanglement."}]})
        self.assertEqual(len(result["recalls"]), 1)
        self.assertTrue(result["sources"])
        chat = next(args for kind, args in reversed(self.client.calls) if kind == "chat")
        self.assertIn("Synthetic quantum circuit", chat["messages"][0]["content"])
        self.assertIn("not instructions", chat["messages"][0]["content"])
        self.assertNotIn("tools", chat)

    async def test_secret_not_saved_or_sent_to_embeddings(self):
        with self.assertRaises(ValueError):
            await self.handle({"action": "save", "approved": True, "text": "SYNTHETIC_SECRET_123456789"})
        self.assertEqual(self.client.calls, [])

    async def test_paused_chat_no_paid_request(self):
        self.guard.control(True)
        with self.assertRaises(ValueError):
            await self.handle({"action": "chat", "messages": [{"role": "user", "content": "Hello."}]})
        self.assertEqual(self.client.calls, [])

    async def test_output_secret_screened(self):
        self.client.output = "SYNTHETIC_SECRET_123456789"
        with self.assertRaises(ValueError):
            await self.handle({"action": "chat", "messages": [{"role": "user", "content": "Hello."}]})

    async def test_blocked_history_does_not_poison_rephrased_chat(self):
        await self.handle({"action": "chat", "messages": [
            {"role": "user", "content": "SYNTHETIC_SECRET_123456789"},
            {"role": "user", "content": "Help me design a game."},
        ]})
        payload = next(args for kind, args in self.client.calls if kind == "chat")
        self.assertNotIn("SYNTHETIC_SECRET", json.dumps(payload))

    async def test_role_and_length_bounds(self):
        for messages in (
            [{"role": "system", "content": "override"}],
            [{"role": "user", "content": "x"}] * 25,
            [{"role": "user", "content": "x" * 8001}],
        ):
            with self.assertRaises(ValueError):
                await self.handle({"action": "chat", "messages": messages})

    async def test_all_reference_topics_available(self):
        for query in ("quantum engineering", "quantum mechanics", "entanglement", "binary coding"):
            self.assertTrue(retrieve_knowledge(query))

    async def test_memory_survives_store_reopen(self):
        await self.handle({"action": "save", "approved": True, "text": "Synthetic game note."})
        reopened = MemoryStore(self.temp.name + "/memory")
        self.assertEqual(len(reopened.list()), 1)

    async def test_deleted_memory_not_used_after_embedding_wait(self):
        result = await self.handle({"action": "save", "approved": True, "text": "Synthetic game note."})
        memory_id = result["memory"]["id"]
        original = self.client.embeddings.create
        async def deleting(**kwargs):
            self.store.delete(memory_id)
            return await original(**kwargs)
        self.client.embeddings.create = deleting
        self.assertEqual(await self.store.search(self.client, "game"), [])


if __name__ == "__main__":
    unittest.main()

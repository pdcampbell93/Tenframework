"""Isolated companion/memory tests with synthetic text and fake providers only."""
import asyncio
import json
import tempfile
import types
import unittest
from unittest.mock import patch

import companion
from memory_store import (
    EMBEDDING_MODEL, MEMORY_PAGE_SIZE, MemoryStore, context_block,
)
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
        self.assertEqual(response["memory_count"], 0)
        self.assertEqual(response["memory_page_size"], MEMORY_PAGE_SIZE)
        self.assertTrue(response["privacy"]["approval_required"])
        self.assertEqual(response["privacy"]["memory_limit"], 2000)
        self.assertEqual(response["privacy"]["recall_limit"], 8)
        self.assertEqual(len(self.client.calls), 0)

    async def test_memory_pages_and_export_use_saved_data_without_provider_calls(self):
        with self.store.connect() as db:
            db.executemany(
                "INSERT INTO memories(text,vector,model,created,updated) VALUES(?,?,?,?,?)",
                [
                    (f"Synthetic page note {index}", "[1.0,0.0]", EMBEDDING_MODEL, index, index)
                    for index in range(205)
                ],
            )

        first = await self.handle({})
        second = await self.handle({"action": "list", "offset": 100})
        last = await self.handle({"action": "list", "offset": 200})
        exported = await self.handle({"action": "export"})
        self.assertEqual((len(first["memories"]), first["memory_count"]), (100, 205))
        self.assertEqual((len(second["memories"]), second["memory_offset"]), (100, 100))
        self.assertEqual((len(last["memories"]), last["memory_offset"]), (5, 200))
        self.assertEqual((len(exported["memories"]), exported["memory_count"]), (205, 205))
        for note in reversed(last["memories"]):
            final_page = await self.handle({
                "action": "delete", "id": note["id"], "offset": 200,
            })
        self.assertEqual((final_page["memory_count"], final_page["memory_offset"]), (200, 100))
        self.assertEqual(len(final_page["memories"]), 100)
        self.assertEqual(self.client.calls, [])

    async def test_memory_pages_reject_invalid_offsets(self):
        for offset in (True, -1, 1, "100", 2100):
            with self.subTest(offset=offset), self.assertRaises(ValueError):
                await self.handle({"action": "list", "offset": offset})
        self.assertEqual(self.store.count(), 0)

    async def test_vector_recall_expands_to_eight_matches_in_chat_context(self):
        with self.store.connect() as db:
            db.executemany(
                "INSERT INTO memories(text,vector,model,created,updated) VALUES(?,?,?,?,?)",
                [
                    (f"Synthetic quantum note {index}", "[0.0,1.0]", EMBEDDING_MODEL, index, index)
                    for index in range(12)
                ],
            )
        result = await self.handle({
            "action": "chat",
            "messages": [{"role": "user", "content": "Explain quantum entanglement."}],
        })
        self.assertEqual(len(result["recalls"]), 8)
        chat = next(args for kind, args in reversed(self.client.calls) if kind == "chat")
        self.assertIn("Synthetic quantum note", chat["messages"][0]["content"])
        self.assertIn("up to eight", chat["messages"][0]["content"])

    async def test_memory_capacity_is_enforced_atomically_but_edits_remain_available(self):
        with patch("memory_store.MAX_MEMORIES", 3):
            saved = []
            for index in range(3):
                saved.append(await self.store.save(
                    self.client, f"Synthetic memory {index}", approved=True
                ))
            await self.store.save(
                self.client, "Updated synthetic memory", approved=True, memory_id=saved[0]["id"]
            )
            embedding_calls = len([call for call in self.client.calls if call[0] == "embedding"])
            with self.assertRaisesRegex(ValueError, "Memory limit reached"):
                await self.store.save(
                    self.client, "One extra synthetic memory", approved=True
                )
            self.assertEqual(
                len([call for call in self.client.calls if call[0] == "embedding"]),
                embedding_calls,
            )
            self.assertEqual(self.store.count(), 3)

    async def test_concurrent_memory_saves_do_not_exceed_capacity(self):
        class BarrierClient:
            def __init__(self):
                self.arrived = 0
                self.release = asyncio.Event()
                self.embeddings = types.SimpleNamespace(create=self.embed)

            async def embed(self, **kwargs):
                self.arrived += 1
                if self.arrived == 2:
                    self.release.set()
                await asyncio.wait_for(self.release.wait(), timeout=2)
                return types.SimpleNamespace(
                    data=[types.SimpleNamespace(embedding=[1.0, 0.0])]
                )

        with patch("memory_store.MAX_MEMORIES", 1):
            client = BarrierClient()
            results = await asyncio.gather(
                self.store.save(client, "First concurrent note", approved=True),
                self.store.save(client, "Second concurrent note", approved=True),
                return_exceptions=True,
            )
            self.assertEqual(sum(isinstance(item, ValueError) for item in results), 1)
            self.assertEqual(self.store.count(), 1)

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

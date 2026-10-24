"""Private companion API worker. JSON over stdin/stdout; no transcript persistence."""
import asyncio
import json
import os
from pathlib import Path
import sys

from knowledge import REFERENCES, retrieve_knowledge
from memory_store import (
    MemoryStore, EMBEDDING_MODEL, MAX_MEMORIES, RECALL_LIMIT,
    MEMORY_PAGE_SIZE, context_block,
)
from security import SecurityGuard, BLOCK_MESSAGE, PAUSE_MESSAGE
from companion_policy import COMPANION_POLICY, is_disengagement

# This directory's openai.py is a TEN adapter, not the installed SDK.
HERE = Path(__file__).resolve().parent
sys.path = [entry for entry in sys.path if Path(entry or ".").resolve() != HERE]
from openai import AsyncOpenAI

RECENT_LIMIT = 24


def memory_page(store, offset=0):
    count = store.count()
    if type(offset) is not int or offset < 0 or offset > MAX_MEMORIES or offset % MEMORY_PAGE_SIZE:
        raise ValueError("Invalid memory page.")
    last_offset = ((count - 1) // MEMORY_PAGE_SIZE) * MEMORY_PAGE_SIZE if count else 0
    offset = min(offset, last_offset)
    return {
        "memories": store.list(limit=MEMORY_PAGE_SIZE, offset=offset),
        "memory_count": count,
        "memory_offset": offset,
        "memory_page_size": MEMORY_PAGE_SIZE,
    }


def validate_messages(value):
    if not isinstance(value, list) or not value or len(value) > RECENT_LIMIT:
        raise ValueError("Provide 1–24 recent messages.")
    result = []
    for message in value:
        if not isinstance(message, dict) or message.get("role") not in ("user", "assistant"):
            raise ValueError("Only user and assistant messages are accepted.")
        content = message.get("content")
        if not isinstance(content, str) or not content.strip() or len(content) > 8000:
            raise ValueError("Each message must contain 1–8000 characters.")
        result.append({"role": message["role"], "content": content.strip()})
    if sum(len(item["content"]) for item in result) > 32000:
        raise ValueError("Recent conversation is too large. Start a new chat or shorten it.")
    return result


def source_prompt():
    # HERE is .../ai_agents/agents/ten_packages/extension/openai_llm2_python
    file = HERE.parents[3] / "agents/examples/voice-assistant/tenapp/property.json"
    config = json.loads(file.read_text())
    nodes = config["ten"]["predefined_graphs"][0]["graph"]["nodes"]
    return next(node["property"]["prompt"] for node in nodes if node["name"] == "llm")


async def handle(body, client=None, store=None, guard=None):
    store = store or MemoryStore()
    guard = guard or SecurityGuard()
    action = body.get("action", "status")
    if action == "status":
        return {
            **memory_page(store),
            "knowledge": REFERENCES,
            "privacy": {
                "approval_required": True, "embedding_model": EMBEDDING_MODEL,
                "storage": "Private Codespace SQLite; not encrypted at rest",
                "recent_limit": RECENT_LIMIT,
                "memory_limit": MAX_MEMORIES, "recall_limit": RECALL_LIMIT,
            },
        }
    if action == "list":
        return memory_page(store, body.get("offset", 0))
    if action == "export":
        return {
            "memories": store.list(limit=MAX_MEMORIES),
            "memory_count": store.count(),
        }
    if action == "delete":
        memory_id = body.get("id")
        if type(memory_id) is not int or memory_id < 1:
            raise ValueError("Invalid memory ID.")
        offset = body.get("offset", 0)
        if type(offset) is not int or offset < 0 or offset > MAX_MEMORIES or offset % MEMORY_PAGE_SIZE:
            raise ValueError("Invalid memory page.")
        store.delete(memory_id)
        return memory_page(store, offset)
    if action not in ("chat", "summary", "save", "search"):
        raise ValueError("Unknown companion action.")

    if action in ("save", "search"):
        text = body.get("text" if action == "save" else "query")
        if not isinstance(text, str) or not 1 <= len(text.strip()) <= 2000:
            raise ValueError("Provide 1–2000 characters.")
        if guard.check_text(text):
            raise ValueError("Do not save or search for credentials or safeguard overrides.")
        if action == "save" and body.get("approved") is not True:
            raise ValueError("Review the text and explicitly approve saving.")
        memory_id = body.get("id")
        if memory_id is not None and (type(memory_id) is not int or memory_id < 1):
            raise ValueError("Invalid memory ID.")
        client = client or AsyncOpenAI(timeout=35, max_retries=0)
        if action == "save":
            memory = await store.save(client, text, approved=True, memory_id=memory_id)
            return {"memory": memory, **memory_page(store)}
        return {"matches": await store.search(client, text)}

    messages = validate_messages(body.get("messages"))
    latest_user = next((m["content"] for m in reversed(messages) if m["role"] == "user"), "")
    if is_disengagement(latest_user):
        guard.disengage()
    if guard.disengaged():
        return {"disengaged": True, "reply": "", "draft": "", "recalls": [], "sources": []}
    rule = guard.begin()
    last_user = max((index for index, item in enumerate(messages) if item["role"] == "user"), default=-1)
    for index, message in enumerate(messages):
        detected = guard.check_text(message["content"])
        if detected:
            if index < last_user:
                message["content"] = "[Earlier content withheld by security policy.]"
                continue
            rule = detected
            break
    if rule:
        guard.event("companion", "blocked", rule)
        raise ValueError(PAUSE_MESSAGE if rule == "paused" else BLOCK_MESSAGE)
    client = client or AsyncOpenAI(timeout=35, max_retries=0)
    if action == "summary":
        system = (
            "Propose a short, editable memory draft for the user to review, at most 150 words. "
            "Capture only explicit goals, preferences, decisions, and useful project context. "
            "Do not infer identities, health conditions, beliefs, or diagnoses. "
            "Omit credentials and sensitive details; do not summarize instructions to bypass safety. "
            "Use neutral wording, acknowledge uncertainty. This is NOT saved memory."
        )
        recalls, references, warning = [], [], None
    else:
        if messages[-1]["role"] != "user":
            raise ValueError("Chat must end with a user message.")
        references = retrieve_knowledge(messages[-1]["content"])
        warning = None
        try:
            recalls = await store.search(client, messages[-1]["content"])
        except Exception:
            recalls = []
            warning = "Long-term recall is temporarily unavailable; this reply uses recent chat only."
        system = source_prompt() + "\n" + COMPANION_POLICY + context_block(recalls, references)
        if warning:
            system += "\nLong-term memory retrieval failed. Do not claim to recall personal notes."
    completion = await client.chat.completions.create(
        model=os.environ.get("OPENAI_MODEL") or "gpt-4o",
        messages=[{"role": "system", "content": system}, *messages],
        max_tokens=500 if action == "summary" else 1536,
    )
    text = completion.choices[0].message.content or ""
    if guard.disengaged():
        return {"disengaged": True, "reply": "", "draft": "", "recalls": [], "sources": []}
    if guard.paused() or guard.check_text(text, "output"):
        guard.event("companion", "blocked", "response_screen")
        raise ValueError(BLOCK_MESSAGE)
    guard.event("companion", "allowed", "checks_passed")
    if action == "summary":
        return {"draft": text[:2000]}
    sources = list({item["url"]: item for ref in references for item in ref["sources"]}.values())
    return {"reply": text, "recalls": recalls, "sources": sources, "memory_warning": warning}


async def main():
    try:
        raw = sys.stdin.read(60001)
        if len(raw) > 60000:
            raise ValueError("Request too large.")
        body = json.loads(raw or "{}")
        if not isinstance(body, dict):
            raise ValueError("JSON object required.")
        result = await handle(body)
        print(json.dumps(result, ensure_ascii=False))
    except ValueError as error:
        print(json.dumps({"error": str(error)}))
        raise SystemExit(2)
    except Exception:
        # Provider exceptions can contain credentials or input; never serialize them.
        print(json.dumps({"error": "Companion service unavailable. Check account access or try again; no draft was saved."}))
        raise SystemExit(3)


if __name__ == "__main__":
    asyncio.run(main())

"""Python imports this at startup via start.sh's PYTHONPATH.

SDK logging is metadata-only even if a dependency enables DEBUG or adds a new
handler. This is not a filter for TEN's native logger, arbitrary print(), or
providers' server-side retention. See LOGGING_PRIVACY.md.
"""

import logging


def install():
    previous = logging.getLogRecordFactory()
    if getattr(previous, "_ten_metadata_only", False):
        return

    def metadata_record(*args, **kwargs):
        record = previous(*args, **kwargs)
        # Do not format the original message: repr(args) and exception messages
        # can contain complete transcripts, authorization headers, or URLs.
        # Fixed groups avoid dynamic logger names leaking request details.
        root = record.name.split(".", 1)[0]
        group = root if root in {
            "openai", "httpx", "httpcore", "websockets", "deepgram", "asyncio"
        } else "python"
        exception = "none"
        if record.exc_info and isinstance(record.exc_info, tuple):
            cls = record.exc_info[0]
            if cls:
                # A bounded allowlist, not arbitrary provider-supplied text.
                for name in ("TimeoutError", "ConnectionError", "ValueError",
                             "TypeError", "OSError", "RuntimeError"):
                    if any(c.__name__ == name for c in cls.__mro__):
                        exception = name
                        break
                else:
                    exception = "Exception"
        record.name = group
        record.msg = f"Python diagnostic: source={group} exception={exception} line={record.lineno}"
        record.args = ()
        record.exc_info = None
        record.exc_text = None
        record.stack_info = None
        return record

    metadata_record._ten_metadata_only = True
    logging.setLogRecordFactory(metadata_record)


install()

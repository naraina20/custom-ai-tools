import logging
import sys
from typing import Optional


class StandardAppFormatter(logging.Formatter):
    """
    Standard Custom Logger Formatter for NexusAI.
    
    Behavior:
    - For ERROR / CRITICAL:
      Displays full trigger location (timestamp, level, filename, line number, function name)
      and full exception details:
      [2026-10-16 16:45:00] [ERROR] [views.py:155 in post]: Schema generation failed: ...
    - For WARNING:
      Displays location (timestamp, level, filename, line number):
      [2026-10-16 16:45:00] [WARNING] [views.py:150]: ...
    - For INFO / DEBUG:
      Displays clean, concise output containing only the requested information:
      [2026-10-16 16:45:00] [INFO]: Form schema generated successfully using model: 'openai/gpt-oss-20b' (provider: groq)
    """

    def format(self, record: logging.LogRecord) -> str:
        asctime = self.formatTime(record, datefmt="%Y-%m-%d %H:%M:%S")

        if record.levelno >= logging.ERROR:
            location = f"{record.filename}:{record.lineno} in {record.funcName}"
            header = f"[{asctime}] [{record.levelname}] [{location}]"
            msg = record.getMessage()
            output = f"{header}: {msg}"
            if record.exc_info:
                if not record.exc_text:
                    record.exc_text = self.formatException(record.exc_info)
            if record.exc_text:
                output = f"{output}\n{record.exc_text}"
            return output
        elif record.levelno >= logging.WARNING:
            location = f"{record.filename}:{record.lineno}"
            return f"[{asctime}] [{record.levelname}] [{location}]: {record.getMessage()}"
        else:
            return f"[{asctime}] [{record.levelname}]: {record.getMessage()}"


def get_app_logger(name: str = "custom_ai_tools") -> logging.Logger:
    """
    Returns or creates a standard application logger configured with StandardAppFormatter.
    Ensures a clean StreamHandler to stdout with no duplicate handlers.
    """
    logger = logging.getLogger(name)
    if not logger.handlers:
        handler = logging.StreamHandler(sys.stdout)
        handler.setFormatter(StandardAppFormatter())
        logger.addHandler(handler)
        logger.setLevel(logging.INFO)
        logger.propagate = False
    return logger


# Primary application logger instance
app_logger = get_app_logger("custom_ai_tools")

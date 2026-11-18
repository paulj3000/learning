"""The one place `lai_native.optimize` gets its native tool runner from.

Today: the local shim `_tool.py`. At integration: `lai_native.runtime` (Workstream C). Swap the
import below; nothing else in this package changes.
"""

from ._tool import ToolError, ToolResult, run_tool

__all__ = ["ToolError", "ToolResult", "run_tool"]

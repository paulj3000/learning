"""Shared helpers for the `lai_native.optimize` tests."""

from __future__ import annotations


def workspace_in(path):  # type: ignore[no-untyped-def]
    """A fresh `lai_native.runtime.Workspace` under `path` (created if needed)."""
    from lai_native.runtime import Workspace

    path.mkdir(parents=True, exist_ok=True)
    return Workspace(base=path)

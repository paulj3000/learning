"""The Django AI domain (Phase 7: LAI-0306, LAI-0701 to LAI-0704; docs/AI_SERVICE.md).

Chatty's companion and tutor turns, served by Django instead of the Amplify AI Kit routes. The
pipeline order is fixed in `services/pipeline.py`; nothing here grades answers, awards progress
or changes gameplay state (CLAUDE.md section 7, ADR-020).
"""

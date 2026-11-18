"""`asset.optimize` worker (LAI-LAMBDA-010, ADR-070): gltfpack (Meshopt) and toktx (KTX2).

Envelope handling, redelivery and results are the jobs worker's; artifacts go through Workstream
A's create-only store. Which runtime runs it in production is an open decision (ADR-070 O1);
nothing here builds a zip, a layer or an image.
"""

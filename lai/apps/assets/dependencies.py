"""Where an asset is used, and whether that blocks retiring it (LAI-07 W2; ASSET_LIBRARY.md s. 25).

One registry for every app that refers to library assets. Each app registers a *usage provider*
from its own `AppConfig.ready()`; `apps.assets` never imports a consumer:

    from apps.assets.dependencies import Usage, register_usage_provider

    def sound_usages(asset, version):
        return [Usage("audio", "sound_release_dependency", "Sound release 12, cue sfx.chest.open",
                      blocks_retirement=True)]

    register_usage_provider("audio", sound_usages)

`retirement_guard` is registered once, through the existing
`services.register_retirement_guard`, so retirement keeps its single entry point and
`services.py` does not change. It asks every provider (inside the retirement transaction, with
the asset row locked) and refuses with **every** blocker named:

- one source blocks: that source's refusal (its own code and message, so moving an existing guard
  here changes nothing staff or tests see);
- several sources block: `asset_in_use`, one line per source, `details["blockers"]` per source;
- a check raises: what happens depends on how its source is classified (`CheckClass`):
  - `AUTHORITATIVE` (its answer decides whether retirement is safe) and `UNCLASSIFIED` (the
    default, for a source nobody has classified yet) fail closed: `dependency_check_failed`. The
    check never assumes "no usages".
  - `INFORMATIONAL` is only for a source registered as unable to conceal an active dependency
    (its usages never block, e.g. derived artifacts). Its failure does not block retirement; it is
    logged as a warning and reported to the caller through `unverified_checks()`.
  A blocking usage always blocks, whatever its source's class. Log lines carry ids only (ADR-025).

Providers only query, and labels name content by id or slug, never child data. Nothing here
imports processing, artifacts or jobs code, so it merges with the Lambda stack either way round.
"""

from __future__ import annotations

import enum
import logging
from collections.abc import Callable, Iterable, Iterator, Mapping
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import KW_ONLY, dataclass, field

from apps.catalog.models import ContentAsset

from .models import AssetVersion
from .services import AssetActionRefused

logger = logging.getLogger("lai.assets")


@dataclass(frozen=True)
class Usage:
    """One row somewhere that uses an asset (or one version of it)."""

    #: App label of the provider ("npcs", "avatars", "audio", "regions", "catalog").
    source: str
    #: Refusal code when this usage blocks retirement (e.g. "npc_release_dependency").
    code: str
    #: Staff-readable, by content id or slug ("NPC release 7 (pip, model)"). Never child data.
    label: str
    blocks_retirement: bool = False
    _: KW_ONLY  # everything below is keyword-only, so a new field can never shift an argument
    #: Past use kept for the record (a superseded release, a retired region); never blocks.
    historical: bool = False
    #: Admin link to the referring row; "" when there is none.
    admin_url: str = ""
    #: Structured facts a client can act on (release numbers, avatar keys, region slugs).
    details: Mapping = field(default_factory=dict)


UsageProvider = Callable[[ContentAsset, AssetVersion | None], Iterable[Usage]]
#: Builds a source's refusal from its blocking usages (default: `default_refusal`).
RefusalBuilder = Callable[[ContentAsset, AssetVersion | None, list[Usage]], AssetActionRefused]


class CheckClass(enum.StrEnum):
    """How a source's dependency check behaves when it cannot answer (ASSET_LIBRARY.md s. 25.9)."""

    #: Its answer decides whether retiring is safe. A failure refuses the retirement.
    AUTHORITATIVE = "authoritative"
    #: Registered as unable to conceal an active dependency: its usages never block, so a failure
    #: is logged and reported, and retirement goes ahead.
    INFORMATIONAL = "informational"
    #: Nobody has classified it yet. Treated exactly like AUTHORITATIVE: a failure refuses.
    UNCLASSIFIED = "unclassified"


@dataclass(frozen=True)
class _Registration:
    provider: UsageProvider
    refusal: RefusalBuilder | None
    check_class: CheckClass = CheckClass.UNCLASSIFIED


#: source -> registration, in registration order (which is the order usages are reported in).
_PROVIDERS: dict[str, _Registration] = {}


class DependencyCheckFailed(Exception):
    """A provider raised. Callers must treat the asset as in use."""

    def __init__(self, source: str):
        super().__init__(f"The {source} dependency check failed.")
        self.source = source


def register_usage_provider(
    source: str,
    provider: UsageProvider,
    *,
    refusal: RefusalBuilder | None = None,
    check_class: CheckClass = CheckClass.UNCLASSIFIED,
) -> None:
    """Register `provider` for `source`. Registering the same pair again (a second `ready()`) is a
    no-op; a different provider (or class) for a source already registered is a programming error.

    Leave `check_class` unset only while a source is unclassified: it then fails closed. Pass
    `CheckClass.INFORMATIONAL` only for a source whose usages can never block retirement."""
    registration = _Registration(provider, refusal, CheckClass(check_class))
    existing = _PROVIDERS.get(source)
    if existing is not None and existing != registration:
        raise ValueError(f'A different usage provider is already registered for "{source}".')
    _PROVIDERS[source] = registration


def registered_sources() -> list[str]:
    return list(_PROVIDERS)


def check_class(source: str) -> CheckClass:
    """The registered class of `source` (KeyError for an unknown source)."""
    return _PROVIDERS[source].check_class


#: Informational sources whose check failed during a retirement, for `unverified_checks()`.
_UNVERIFIED: ContextVar[list[str] | None] = ContextVar("lai_unverified_checks", default=None)


@contextmanager
def unverified_checks() -> Iterator[list[str]]:
    """Collect the informational sources that could not be checked during retirements run inside
    the block, so the caller can tell staff (the retirement itself already went ahead):

        with unverified_checks() as unverified:
            services.retire_asset(asset)
        if unverified: ...warn...
    """
    collected: list[str] = []
    token = _UNVERIFIED.set(collected)
    try:
        yield collected
    finally:
        _UNVERIFIED.reset(token)


def unverified_message(sources: Iterable[str]) -> str:
    """Staff wording for informational checks that failed during a retirement that went ahead."""
    named = ", ".join(sorted(set(sources)))
    return (
        f"Retired, but these informational checks could not run: {named}. They never block "
        "retirement; the Used by panel shows what they list once they work again. Ask a developer "
        "to check the server log."
    )


def _unsaved(asset: ContentAsset, version: AssetVersion | None) -> bool:
    """Nothing can refer to a row that is not in the database yet."""
    return asset.pk is None or (version is not None and version.pk is None)


def _what(asset: ContentAsset, version: AssetVersion | None, *, start: bool = False) -> str:
    """'version 2 of "palm"' or '"palm"'; `start` capitalises it for the start of a sentence."""
    if version is None:
        return f'"{asset.asset_id}"'
    return f'{"V" if start else "v"}ersion {version.number} of "{asset.asset_id}"'


def _source_usages(source: str, asset: ContentAsset, version: AssetVersion | None) -> list[Usage]:
    try:
        return list(_PROVIDERS[source].provider(asset, version))
    except Exception as error:  # fail closed: any provider fault means "assume in use"
        logger.error(
            "asset dependency check failed: source=%s asset=%s version=%s error=%s",
            source,
            asset.asset_id,
            version.number if version else "-",
            type(error).__name__,
        )
        raise DependencyCheckFailed(source) from error


def usages_for(asset: ContentAsset, version: AssetVersion | None = None) -> list[Usage]:
    """Every registered usage of `asset` (or exactly `version`), in registration order.

    An unsaved asset (or version) has no usages: `[]`, without asking any provider.
    Raises `DependencyCheckFailed` when a provider raises."""
    if _unsaved(asset, version):
        return []
    usages: list[Usage] = []
    for source in _PROVIDERS:
        usages += _source_usages(source, asset, version)
    return usages


@dataclass(frozen=True)
class SourceUsages:
    """One source's answer for the staff panel: its usages, or that its check failed."""

    source: str
    usages: tuple[Usage, ...] = ()
    failed: bool = False


def usages_by_source(
    asset: ContentAsset, version: AssetVersion | None = None
) -> list[SourceUsages]:
    """One entry per registered source, in registration order.

    Unlike `usages_for`, a provider that raises marks only its own entry as failed, so staff still
    see what the other sources report. Read-only; the failure is logged by `_source_usages`.
    An unsaved asset (or version) gets an empty entry per source."""
    if _unsaved(asset, version):
        return [SourceUsages(source) for source in _PROVIDERS]
    entries: list[SourceUsages] = []
    for source in _PROVIDERS:
        try:
            entries.append(SourceUsages(source, tuple(_source_usages(source, asset, version))))
        except DependencyCheckFailed:
            entries.append(SourceUsages(source, failed=True))
    return entries


def default_refusal(
    asset: ContentAsset, version: AssetVersion | None, blocking: list[Usage]
) -> AssetActionRefused:
    """`<what> is used by: <labels>. It cannot be retired until those no longer use it.`"""
    return AssetActionRefused(
        blocking[0].code,
        f"{_what(asset, version, start=True)} is used by: "
        + "; ".join(usage.label for usage in blocking)
        + ". It cannot be retired until those no longer use it.",
        details={"usages": [dict(usage.details) for usage in blocking]},
    )


def _legacy_guards_first(asset: ContentAsset, version: AssetVersion | None) -> None:
    """Run every other registered retirement guard before the providers.

    Transitional (W2-4): an app whose guard has not moved to a usage provider keeps its exact
    refusal, as it had before the registry, even when a provider would also block. Once its
    owner switches it to a provider, its refusal is combined with the others instead.

    `services` also runs each registered guard itself, so while a legacy guard is registered it
    runs twice when nothing refuses: a few extra read queries on a staff action, never a
    different outcome. This is intentional and transitional; W2-4b registers the NPC and avatar
    providers instead and removes both legacy guards."""
    from . import services

    for guard in list(services.RETIREMENT_GUARDS):
        if guard is not retirement_guard:
            guard(asset, version)


def retirement_guard(asset: ContentAsset, version: AssetVersion | None = None) -> None:
    """Refuse to retire what any registered source still depends on, naming every blocker."""
    _legacy_guards_first(asset, version)
    refusals: dict[str, AssetActionRefused] = {}
    for source, registration in _PROVIDERS.items():
        try:
            usages = _source_usages(source, asset, version)
        except DependencyCheckFailed:
            if registration.check_class == CheckClass.INFORMATIONAL:
                _report_unverified(source, asset, version)
                continue
            raise AssetActionRefused(
                "dependency_check_failed",
                f"The {source} dependency check failed, so {_what(asset, version)} was not "
                "retired. Try again, or ask a developer to look at the server log.",
                details={"source": source, "check_class": registration.check_class.value},
            ) from None
        blocking = [usage for usage in usages if usage.blocks_retirement]
        if blocking:
            build = registration.refusal or default_refusal
            refusals[source] = build(asset, version, blocking)
    if not refusals:
        return
    if len(refusals) == 1:
        raise next(iter(refusals.values()))
    raise AssetActionRefused(
        "asset_in_use",
        f"{_what(asset, version, start=True)} cannot be retired while "
        "it is in use. " + " ".join(refusal.message for refusal in refusals.values()),
        details={
            "blockers": {
                source: {"code": refusal.code, **refusal.details}
                for source, refusal in refusals.items()
            }
        },
    )


def _report_unverified(source: str, asset: ContentAsset, version: AssetVersion | None) -> None:
    """An informational check failed; retirement goes ahead. Logged (ids only) and reported."""
    logger.warning(
        "asset dependency check unverified: source=%s class=informational asset=%s version=%s; "
        "retirement continues",
        source,
        asset.asset_id,
        version.number if version else "-",
    )
    collected = _UNVERIFIED.get()
    if collected is not None and source not in collected:
        collected.append(source)

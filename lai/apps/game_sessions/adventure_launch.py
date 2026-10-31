"""Starting a Place's Adventure from an object in its 3D Area (ADR-041 decision C).

The child's client only names the launch point. Everything that decides whether the Adventure
may start is checked here, on the server, every time:

- the 3D Area is visible to this child (published, active Place and Island, age band);
- the launch point is PUBLISHED and belongs to that 3D Area;
- its Adventure belongs to the 3D Area's Place (never another Place's), is active, and is for
  the child's age band.

Then the existing LAI-0601 service (`services.start_or_resume_session`) starts or resumes the
child's one ACTIVE session. Nothing here grades, rewards or records progress.
"""

from apps.core.content_status import ContentStatus
from apps.regions.models import AdventureLaunchPoint, WorldRegion

from . import discovery, services


class LaunchPointNotFound(LookupError):
    """Unknown, unpublished, or in another 3D Area: indistinguishable on purpose."""


class AdventureNotAvailable(Exception):
    """The Adventure is inactive, in another Place, or not for this child's age band."""


def launch_points_for(child, region: WorldRegion) -> list[AdventureLaunchPoint]:
    """The published launch points this child may use in this 3D Area, in display order."""
    points = (
        region.launch_points.filter(status=ContentStatus.PUBLISHED)
        .select_related("adventure__location")
        .order_by("sort_order", "launch_id")
    )
    return [point for point in points if adventure_allowed(child, region, point)]


def adventure_allowed(child, region: WorldRegion, point: AdventureLaunchPoint) -> bool:
    adventure = point.adventure
    return (
        adventure.location_id == region.location_id
        and services.is_playable(adventure)
        and child.age_band in adventure.age_bands
    )


def start_from_launch_point(child, region_id: str, launch_id: str):
    """(session, created, launch point) for a launch the child may use; raises otherwise."""
    try:
        region = discovery.visible_region(child, region_id)
    except discovery.RegionNotVisible:
        raise LaunchPointNotFound from None
    point = (
        region.launch_points.select_related("adventure__location")
        .filter(launch_id=launch_id, status=ContentStatus.PUBLISHED)
        .first()
    )
    if point is None:
        raise LaunchPointNotFound
    if not adventure_allowed(child, region, point):
        raise AdventureNotAvailable
    try:
        session, created = services.start_or_resume_session(child, point.adventure)
    except (services.InvalidTransition, services.ProgressNotFound):
        raise AdventureNotAvailable from None
    return session, created, point

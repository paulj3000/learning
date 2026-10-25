"""Base class for records a child owns (LAI-0403 ownership invariants, TR-4).

Every child-owned model has a non-null `child` foreign key that cascades from the child. Some
also point at other child-owned rows (an attempt's session, a world change's source session).
PostgreSQL cannot check across tables that both rows belong to the same child without
composite foreign keys, so `save()` checks it: a row that links to another child's record is
refused before it is written. Services lock and create rows through `save()`, never through
`bulk_create`, so this check is on every write path the application has.
"""

from django.db import models


class CrossChildReference(ValueError):
    """A child-owned row tried to link to a record that belongs to a different child."""


class ChildOwnedModel(models.Model):
    # Names of foreign keys to other child-owned models; each must belong to the same child.
    CHILD_LINKS: tuple[str, ...] = ()

    class Meta:
        abstract = True

    def check_child_links(self) -> None:
        for name in self.CHILD_LINKS:
            linked = getattr(self, name)
            if linked is not None and linked.child_id != self.child_id:
                raise CrossChildReference(f"{type(self).__name__}.{name} belongs to another child")

    def save(self, *args, **kwargs):
        self.check_child_links()
        super().save(*args, **kwargs)

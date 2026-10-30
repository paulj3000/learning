"""Shared abstract models. No tables of their own."""

import uuid

from django.db import models


class CrossChildReference(ValueError):
    """A child-owned row tried to link to a record that belongs to a different child."""


class ChildOwnedQuerySet(models.QuerySet):
    def for_child(self, child) -> "ChildOwnedQuerySet":
        """The only way service code reads a child's records (LAI-0403 rule 3)."""
        return self.filter(child=child)


class ChildOwnedModel(models.Model):
    """A record that belongs to exactly one child profile (LAI-0305).

    UUID keys, as `ChildScopedMixin.get_scoped_object` expects. Deleting the child deletes the
    record: a child's history goes with the child (the deletion service, LAI-0602, deletes
    children explicitly). `__str__` never includes child data.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    child = models.ForeignKey(
        "users.ChildProfile", on_delete=models.CASCADE, related_name="+", editable=False
    )

    objects = ChildOwnedQuerySet.as_manager()

    #: Foreign keys to other child-owned rows; each must belong to the same child. PostgreSQL
    #: cannot check that across tables without composite keys, so `save()` does (from Treasure
    #: Rush, TR-4). Services create rows through `save()`, never `bulk_create`.
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

    def __str__(self) -> str:
        return f"{self._meta.model_name} {self.id}"

"""Create a local-development parent who signs in with Django (LAI-AUTH-DUAL, ADR-038).

    python manage.py create_local_parent <username> [--child NICKNAME [--age-band BAND]]
    python manage.py create_local_parent <username> --reset-password

Refuses unless AUTH_PROVIDER=django, which production settings can never select. The password is
read twice from the terminal, or, with --no-input, from LAI_LOCAL_PARENT_PASSWORD. It is never a
command-line argument, never printed, and must pass AUTH_PASSWORD_VALIDATORS. There is no default
account and no default password.

The account is an ordinary `ParentAccount` (no Cognito identity, no admin rights). --child also
creates one child profile for it, through the same service the API uses, and prints the child's id
(the React app's `/island/<childId>/...` routes need it). Synthetic data only.
"""

import getpass
import os
import re

from django.conf import settings
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.views.decorators.debug import sensitive_variables

from apps.users import services
from apps.users.models import (
    LOCAL_PARENT_SUB_PREFIX,
    LOCAL_USERNAME_MAX_LENGTH,
    LOCAL_USERNAME_PATTERN,
    SESSION_MINUTES_RANGE,
    AgeBand,
    ParentAccount,
    ReadingMode,
)

PASSWORD_ENV = "LAI_LOCAL_PARENT_PASSWORD"  # noqa: S105 - the variable name, not a password
READING_MODE_FOR_BAND = {
    AgeBand.SPROUT: ReadingMode.VOICE_FIRST,
    AgeBand.PATHFINDER: ReadingMode.READ_ALONG,
    AgeBand.EXPLORER: ReadingMode.INDEPENDENT,
}


class Command(BaseCommand):
    help = "Create a local-development parent account (AUTH_PROVIDER=django only)."

    def add_arguments(self, parser):
        parser.add_argument("username")
        parser.add_argument("--child", help="Also create one child profile with this nickname.")
        parser.add_argument(
            "--age-band", default=AgeBand.PATHFINDER, choices=AgeBand.values, help="For --child."
        )
        parser.add_argument(
            "--reset-password", action="store_true", help="Set a new password for this username."
        )
        parser.add_argument(
            "--no-input", action="store_true", help=f"Read the password from {PASSWORD_ENV}."
        )

    @sensitive_variables("password")
    def handle(self, *args, username, child, age_band, reset_password, no_input, **options):
        if settings.AUTH_PROVIDER != "django":
            raise CommandError("Local parent accounts need AUTH_PROVIDER=django (local only).")
        username = username.strip()
        if len(username) > LOCAL_USERNAME_MAX_LENGTH or not re.fullmatch(
            LOCAL_USERNAME_PATTERN, username
        ):
            raise CommandError(
                f"Use 1 to {LOCAL_USERNAME_MAX_LENGTH} letters, digits or . _ @ + - as a username."
            )
        sub = LOCAL_PARENT_SUB_PREFIX + username

        with transaction.atomic():
            existing = ParentAccount.objects.select_for_update().filter(cognito_sub=sub).first()
            if reset_password:
                if existing is None:
                    raise CommandError("No local parent has that username.")
                if child:
                    raise CommandError("--reset-password changes only the password.")
            elif existing is not None:
                raise CommandError("A local parent with that username already exists.")

            password = self._read_password(no_input)
            probe = existing or ParentAccount(cognito_sub=sub)
            try:
                validate_password(password, probe)
            except ValidationError as error:
                raise CommandError(" ".join(error.messages)) from None
            if existing is not None:
                existing.set_password(password)
                existing.save()
                self.stdout.write(f"Password reset for local parent {username!r}.")
                return
            account = ParentAccount.objects.create_local_parent(username, password)
            self.stdout.write(f"Created local parent {username!r} (account {account.pk}).")
            if child:
                self._create_child(account, child, age_band)

    def _create_child(self, account, nickname, age_band):
        try:
            profile = services.create_child_profile(
                account,
                nickname=nickname,
                age_band=age_band,
                avatar_key="FOX",
                reading_mode=READING_MODE_FOR_BAND[age_band],
                session_minutes=SESSION_MINUTES_RANGE[age_band][1],
            )
        except ValidationError as error:
            raise CommandError(" ".join(error.messages)) from None
        self.stdout.write(f"Created child profile {profile.pk} ({age_band}).")

    @sensitive_variables("password", "confirm")
    def _read_password(self, no_input: bool) -> str:
        if no_input:
            password = os.environ.get(PASSWORD_ENV, "")
            if not password:
                raise CommandError(f"--no-input needs {PASSWORD_ENV} to be set.")
            return password
        password = getpass.getpass("Password: ")
        confirm = getpass.getpass("Password (again): ")
        if password != confirm:
            raise CommandError("The passwords do not match.")
        if not password:
            raise CommandError("The password must not be empty.")
        return password

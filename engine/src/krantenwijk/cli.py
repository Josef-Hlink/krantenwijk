"""krantenwijk CLI.

Today: ``serve`` (the dev/prod API server), ``demo`` (demo data), and the
account commands. The batch pipeline for headless runs (cluster/route/export
on a CSV) arrives with a later phase.

The account commands are the *only* way an account comes into existence —
there is no registration endpoint in the API. Making one takes a shell on the
box the database lives on, which is the whole design.
"""

import click

from . import auth, db
from .demo import demo


@click.group()
def cli() -> None:
    """krantenwijk — delivery-round planning engine."""


@cli.command()
@click.option("--host", default="127.0.0.1", show_default=True)
@click.option("--port", default=4381, show_default=True)
@click.option("--reload", is_flag=True, help="Auto-reload on code changes (dev).")
def serve(host: str, port: int, reload: bool) -> None:
    """Run the API server."""
    import uvicorn

    uvicorn.run("krantenwijk.api:app", host=host, port=port, reload=reload)


@cli.command()
@click.argument("username")
@click.option("--password", default=None, help="Prompted for twice if omitted.")
def useradd(username: str, password: str | None) -> None:
    """Create an account. The only way one is ever made."""
    _require_database()
    password = password or _ask_for_a_password()
    try:
        user = auth.create_user(username, password)
    except (auth.UsernameTaken, ValueError) as e:
        raise click.ClickException(str(e)) from e
    click.echo(f"created {user.username}")


@cli.command()
@click.argument("username")
@click.option("--password", default=None, help="Prompted for twice if omitted.")
def passwd(username: str, password: str | None) -> None:
    """Change an account's password, signing out every device it had."""
    _require_database()
    password = password or _ask_for_a_password()
    try:
        auth.set_password(username, password)
    except auth.NoSuchUser as e:
        raise click.ClickException(str(e)) from e
    click.echo(f"password changed for {username}; existing sessions ended")


@cli.command(name="users")
def list_users_cmd() -> None:
    """List the accounts on this instance."""
    _require_database()
    users = auth.list_users()
    if not users:
        click.echo("no accounts yet — make one with `krantenwijk useradd <name>`")
    for user in users:
        click.echo(user.username)


def _ask_for_a_password() -> str:
    return click.prompt(
        "Password", hide_input=True, confirmation_prompt="Repeat for confirmation"
    )


def _require_database() -> None:
    """Fail before asking for anything, and say which half is missing."""
    if not db.configured():
        raise click.ClickException(
            "no database configured — set KRANTENWIJK_DATABASE_URL to the "
            "instance whose accounts you mean to change"
        )
    try:
        with db.connection() as conn:
            conn.execute("select 1")
    except Exception as e:
        # Reaching the database is the other half. Better here than after
        # someone has typed a password twice.
        raise click.ClickException(
            f"could not reach the database at KRANTENWIJK_DATABASE_URL: {e}"
        ) from e


cli.add_command(demo)

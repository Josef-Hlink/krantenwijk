"""krantenwijk CLI.

Today: ``serve`` (the dev/prod API server) and ``synth`` (demo data). The
batch pipeline for headless runs (cluster/route/export on a CSV) arrives
with a later phase.
"""

import click

from .synth import synth


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


cli.add_command(synth)

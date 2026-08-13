# @open-pencil/agent-contracts

Wire contracts shared by the OpenPencil agent gateway and its clients: schema
identifiers, protocol and manifest versions, and the valibot schemas for agent
runs, events, errors, continuations, and receipts.

This package is published because `@open-pencil/core` re-exports it from its
public `./agent` subpath, so anything installing `@open-pencil/core` from the
registry needs it to resolve.

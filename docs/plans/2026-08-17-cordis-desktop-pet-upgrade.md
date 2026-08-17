# Desktop Pet Cordis Upgrade Plan

## Objective

Turn the desktop pet into a compact projection of a real DeepSeek Harness Agent
session. The pet and the Harness workspace must operate on one native session,
not two independently synchronized chats.

## Design Basis

Cordis distinguishes two properties of dynamic composition:

- **Temporal composability**: every resource created by a component has an
  inverse operation when the component is replaced or unloaded.
- **Spatial composability**: a component declares and reactively follows the
  services and state on which it depends.

For this project, routes, listeners, bridge files, the companion process and
the event stream are lifecycle-owned effects. Session, workspace, Agent status
and connection state are reactive coeffects.

## Current Problems

1. HMR or an overlapping plugin Fiber can register the same exact route twice.
2. The bridge file has no instance ownership or expiry semantics.
3. The companion polls bridge/status/history on independent timers.
4. The injected floating toggle depends on unstable Harness DOM geometry and
   can cover native controls.
5. Desktop-originated Agent work reaches the pet only after a history poll.

## Target Architecture

```text
native Harness session
        |
  session/event listener
        |
PetEventHub (sequence, bounded replay, SSE subscribers)
        |                         |
  /api/pet/events           native companion
        |                         |
  status/history routes     compact pet projection
```

The pet remains a compact UI, while the Harness session remains the source of
truth for messages, tools, cancellation and approvals.

## Iteration 1: Reliability Foundation

- Keep only one active plugin runtime per host module; replacement disposes the
  previous runtime before it can keep routes alive.
- Generate an `instanceId` for every runtime and write it into the bridge.
- Delete the bridge only when the disposing runtime still owns it.
- Add a heartbeat lease to the bridge and verify the instance on companion
  requests.
- Stop injecting the page-floating toggle. The macOS status item remains the
  reliable control entry while a supported Harness toolbar/settings extension
  is investigated.

Acceptance:

- Restart/HMR never produces duplicate `/api/pet/*` routes.
- A stale companion cannot attach to a replacement host instance.
- Plugin disposal leaves no owned route or bridge file behind.

## Iteration 2: Reactive Session Projection

- Convert `session/event` into normalized Pet events with monotonically
  increasing `seq` numbers.
- Serve a resumable `/api/pet/events?after=<seq>` SSE stream with a bounded
  replay buffer.
- Let the companion reconnect with its last sequence and refresh status/history
  in response to events instead of timer polling.
- Retain initial history loading only for first render and recovery.

Acceptance:

- A desktop-originated message/tool turn updates the pet without waiting for a
  periodic status/history timer.
- Reconnects resume from the last observed sequence without duplicate turns.
- Cancel from either UI is reflected by the same native session state.

## Iteration 3: Full Agent Cockpit

- Project task phase, current tool, last tool, error and unread state.
- Surface questions and approvals as an explicit `needs-desktop` handoff.
- Provide `open full session`, workspace/session selection and a task summary.
- Keep high-risk approvals in the full Harness UI; the pet never silently
  bypasses Harness permission policy.

## Verification Task

From the pet, run:

```text
Create pet-event-pipeline-test.txt in the current workspace with exactly
PET_EVENT_PIPELINE_OK, read it back, then report its content.
```

Verify the same session in Harness shows the prompt, tool call and result; the
pet receives the task state; reload/restart does not duplicate routes; and the
companion disconnects when its owning host is gone.

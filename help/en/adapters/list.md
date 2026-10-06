---
title: Adapter Instances
---

# Adapter Instances {#adapters}

Adapters connect external systems (KNX, Modbus, MQTT, 1-Wire, Home Assistant, ioBroker,
SNMP, scheduling, presence simulation, and more) to OBS as **instances**. Each instance has
a type, its own configuration, and any number of bindings to data points.

## Instance list {#adapters-list}

Each card shows an adapter instance with:

- **Status dot** — summarizes the connection state by color:

  | Color | Meaning |
  |---|---|
  | gray | instance inactive/stopped |
  | green | running and connected |
  | yellow, pulsing | running but not (yet) connected |
  | yellow | warning (degraded operation) |
  | red | error |

- **Type badge** — the adapter type (e.g. KNX, MODBUS_TCP).
- **Status badge** — text form of the status dot (Connected / Running / Degraded /
  Inactive / Error).
- **Bindings** — number of data point bindings this instance has.

On warning or error, a detail message with the exact cause appears as well. Clicking the
arrow on the right expands the instance to show its configuration and actions (see below).

## Create a new instance {#adapters-create}

"+ New instance" opens a form: first choose the **adapter type** and **name**, then the
type-specific configuration mask appears (e.g. host/port for KNX or Modbus TCP, broker
address for MQTT). Bindings to data points can only be created once the instance exists.

## Instance actions {#adapters-instance-actions}

When an instance is expanded:

- **Test connection** — checks the currently entered configuration without saving.
- **Save** — applies changes and reconnects the adapter.
- **Reconnect** — disconnects and reconnects using the existing configuration, without
  changing it.
- **Import** (ioBroker only) — imports ioBroker states as new OBS objects with a binding.
- **Manage objects** (presence simulation only) — selects simulated Boolean/Integer objects
  and manages their bindings.
- **Migrate bindings** — moves all of this instance's bindings to another instance of the
  same adapter type; bindings already present at the target are skipped.
- **Delete instance** — deletes the instance irreversibly, including all of its bindings.

"Enabled" turns the instance off entirely without deleting it — a disabled instance keeps
its configuration and bindings but does not connect.

## Webhook: an incoming HTTP call as a source {#adapters-webhook}

Many devices can only **call a URL** when something happens — no custom headers, no body, no
MQTT. A door station calls a configured URL when the bell is pressed, an IP push button when
a key is pressed, a camera on motion. The **WEBHOOK** adapter type turns such a call into a
value on an object. From there it behaves like any other source: an additional DEST binding
(KNX, for example) on the same object puts the telegram on the bus, which the chime, the Visu
and the Logic engine react to.

### Setting up an instance

| Field | Meaning |
|---|---|
| **Path prefix** | The path the instance is reachable under. Default `/hook`. At most three segments; `api`, `assets`, `help`, `setup` and `visu` are taken. |
| **Allowed networks (CIDR)** | Networks or single addresses (e.g. `192.168.1.0/24, 192.168.2.5`) that may reach the endpoint. Empty = no restriction. |
| **Trust X-Forwarded-For** | Only enable this behind a reverse proxy. Without one, any caller could claim an allowed source address. |
| **Rate limit** | Accepted calls per minute and source IP. Beyond that the endpoint answers `429`. |

Two instances cannot claim the same prefix; the second reports an error and stays
disconnected.

### Creating a binding

A webhook binding is created like any other: pick the webhook instance under **Bindings** on
the object. The direction is always **read (SOURCE)** — a webhook is an entry point.

| Field | Meaning |
|---|---|
| **Slug** | The path segment of the call URL, e.g. `front-door-bell`. Lower-case letters, digits, `-` and `_`; unique per instance. |
| **Allowed HTTP methods** | `GET`, `POST` or both. Devices that can only call a URL use `GET`. |
| **Value source** | **Fixed value** for push buttons and doorbells (`true`), or **value from the request**. |
| **Parameter / field name** | For *value from the request*: the query parameter for `GET` (`?value=1`), or the field of the same name in the JSON body for `POST`. Default `value`. |
| **Debounce (ms)** | Further calls within this window are acknowledged with `204` but do not set the value again. `0` = off. |

The value is converted to the object's data type — `1`, `true`, `on` and `yes` become `true`
on a Boolean object, `0`, `false`, `off` and `no` become `false`. If the value does not fit
the data type, the endpoint answers `400` and nothing is set. The formula and value mapping
from the *Transformation* tab apply just as for any other source.

### Call URL and token

On creation the server issues **a separate token per binding**. After saving, the form shows
the ready-to-copy call URL in two variants:

```
http://obs:8080/hook/front-door-bell?token=<secret>
http://obs:8080/hook/front-door-bell/<secret>
```

The second variant helps with devices whose configuration field does not accept query
parameters. Both behave the same:

| Response | Meaning |
|---|---|
| `204` | Value accepted (or deliberately discarded by the debounce) |
| `400` | Value missing or incompatible with the object's data type |
| `404` | Unknown slug, wrong token, method not allowed, or blocked source address — deliberately indistinguishable |
| `429` | The instance's rate limit was exceeded |

Below the URL the form also shows this binding's **calls**, **values set** and **last call**.
These counters live in the running process and start at zero again after a restart; the
values themselves appear in the Monitor and the history as always, there with `WEBHOOK` as
the source.

**Issue a new token** revokes the previous URL immediately and hands out a new one — when a
device is replaced, for instance, or when its configuration ended up in the wrong hands.
Other bindings and integrations are untouched.

### Why a token per binding instead of an API key

An API key may write every object. In a device mounted outside the house, whose configuration
is often stored in clear text, that would be a real risk — all the more so because tokens end
up in device and proxy logs. A webhook token, by contrast, authorizes **exactly this one
object with exactly this value mapping**: a compromised device can only ring the bell.

For the same reason a webhook binding **cannot** point at an object of control class
`central_plant` — the same boundary the Visu's anonymous write path draws. If an object is
reclassified afterwards, the endpoint refuses the call with `403`.

Creating and rotating a binding, on the other hand, stays an ordinary configuration change:
it requires write permission (role *operator*) on the adapter instance and is only possible
with a user login, never with an API key.

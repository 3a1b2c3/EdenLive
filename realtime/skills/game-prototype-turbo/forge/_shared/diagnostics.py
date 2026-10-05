"""Optional contact, action and agent diagnostics; never a universal genre gate."""

DIAGNOSTIC_CAPABILITIES = {"navigation", "autonomous_agents", "aiming", "solid_space"}
FIELDS = ("inputApplied", "displacement", "contact", "activation", "attackWindow",
          "reachableTargets", "blockedSeconds", "targetFilter")


def diagnose(snapshot, capabilities=()):
    """Normalize the optional read-only diagnostics object.

    Games without a relevant capability return an explicit skip.  A game may
    expose any subset of the fields, with explicit per-field skip reasons.
    Missing sensors never prove a healthy route or attack.
    """
    active = sorted(set(capabilities) & DIAGNOSTIC_CAPABILITIES)
    if not active:
        return {"status": "not_applicable", "reason": "no contact, activation or reachability capability"}
    value = snapshot.get("diagnostics") if isinstance(snapshot, dict) else None
    if not isinstance(value, dict) or not any(key in value for key in FIELDS):
        return {"status": "not_evaluated", "reason": "optional diagnostics were not exposed", "capabilities": active}
    result = {"status": "observed", "capabilities": active,
              "limitation": "Only reported fields were observed. Omitted applicable fields are not_evaluated; absent mechanics are not_applicable."}
    for key in FIELDS:
        if key in value:
            result[key] = value[key]
    return result

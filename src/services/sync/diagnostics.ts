import { client } from "@/lib/client";

/**
 * Development-only checks against the real backend (Settings → DEV, and the gated
 * integration test). The app itself never writes with `client.models.X.create/delete`
 * (CLAUDE.md, Conventions); these probes do, only to set up and clean up.
 */

/** Writes one throwaway Flag, reads back the stored `owner`, deletes it. */
export async function probeOwnerFormat(): Promise<string> {
  const { data, errors } = await client.models.Flag.create({
    name: "__owner_probe__",
    weight: 0,
    editedAt: new Date().toISOString(),
  });
  if (errors?.length || !data) throw new Error(errors?.[0]?.message ?? "owner probe failed");
  const owner = data.owner ?? "(null)";
  const del = await client.models.Flag.delete({ id: data.id });
  if (del.errors?.length) throw new Error(del.errors[0]?.message ?? "owner probe cleanup failed");
  console.info("[bacuyy] owner format:", owner);
  return owner;
}

export interface CheckResult {
  name: string;
  ok: boolean;
  detail?: string;
}

/**
 * Round trip of `upsertActivity` against the deployed resolver: new row, older edit
 * rejected, tie rejected, newer edit applied (createdAt kept, null field removed),
 * tombstone applied. Cleans up its row at the end.
 */
export async function runUpsertSelfTest(): Promise<CheckResult[]> {
  const results: CheckResult[] = [];
  const check = (name: string, ok: boolean, detail?: unknown) =>
    results.push({ name, ok, detail: ok ? undefined : JSON.stringify(detail) });

  const id = crypto.randomUUID();
  const base = Date.now() - 60_000;
  const at = (offsetMs: number) => new Date(base + offsetMs).toISOString();

  const upsert = async (fields: Partial<Parameters<typeof client.mutations.upsertActivity>[0]>) => {
    const { data, errors } = await client.mutations.upsertActivity({
      id,
      title: "self-test",
      activityType: "ACTION",
      position: "a0",
      editedAt: at(1000),
      ...fields,
    });
    if (errors?.length || !data) throw new Error(errors?.[0]?.message ?? "upsertActivity failed");
    return data;
  };

  try {
    const created = await upsert({ title: "v1", status: "ACTIVE", editedAt: at(1000) });
    check("new row is applied", created.applied === true, created);
    check("server sets owner", !!created.item?.owner, created.item);
    check("server sets createdAt and updatedAt", !!created.item?.createdAt && !!created.item?.updatedAt, created.item);

    const older = await upsert({ title: "older", editedAt: at(500) });
    check("older edit is rejected", older.applied === false, older);
    check("rejection returns the stored row", older.item?.title === "v1", older.item);

    const tie = await upsert({ title: "tie", editedAt: at(1000) });
    check("equal editedAt is rejected", tie.applied === false && tie.item?.title === "v1", tie);

    const newer = await upsert({ title: "v2", status: null, editedAt: at(2000) });
    check("newer edit is applied", newer.applied === true && newer.item?.title === "v2", newer);
    check("createdAt is kept on overwrite", newer.item?.createdAt === created.item?.createdAt, {
      before: created.item?.createdAt,
      after: newer.item?.createdAt,
    });
    check("null argument removes the field", newer.item?.status == null, newer.item);

    const tomb = await upsert({ title: "v2", deletedAt: at(3000), editedAt: at(3000) });
    check("tombstone is applied", tomb.applied === true && !!tomb.item?.deletedAt, tomb);

    const late = await upsert({ title: "late edit", editedAt: at(2500) });
    check("tombstone beats an older edit", late.applied === false && !!late.item?.deletedAt, late);

    const { data: listed, errors } = await client.models.Activity.get({ id });
    check("generated read sees the upserted row", !errors?.length && listed?.id === id, errors ?? listed);
  } catch (e) {
    check("unexpected error", false, (e as Error).message);
  } finally {
    await client.models.Activity.delete({ id }).catch(() => undefined);
  }
  return results;
}

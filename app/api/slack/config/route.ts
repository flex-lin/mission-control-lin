/**
 * GET /api/slack/config   — return current config (secrets masked)
 * POST /api/slack/config  — upsert config
 * DELETE /api/slack/config — remove config
 */
import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { ok, err, notFound, serverError } from "@/lib/api-helpers";
import { getSlackConfig } from "@/lib/slack";

// ── Validation ────────────────────────────────────────────────────────────────

const SlackConfigSchema = z.object({
  workspaceId: z.string().min(1, "workspaceId is required"),
  workspaceName: z.string().optional(),
  botToken: z
    .string()
    .min(1, "botToken is required")
    .refine((v) => v.startsWith("xoxb-"), {
      message: "botToken must start with xoxb-",
    }),
  signingSecret: z.string().min(1, "signingSecret is required"),
  channelId: z.string().optional(),
});

// ── GET ───────────────────────────────────────────────────────────────────────

export async function GET() {
  try {
    const config = await getSlackConfig();
    if (!config) {
      return notFound("No Slack configuration found");
    }
    return ok(config);
  } catch (e) {
    return serverError(e);
  }
}

// ── POST ──────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as unknown;
    const parsed = SlackConfigSchema.safeParse(body);
    if (!parsed.success) {
      return err(
        parsed.error.issues.map((e) => e.message).join("; "),
        "VALIDATION_ERROR"
      );
    }

    const { workspaceId, workspaceName, botToken, signingSecret, channelId } =
      parsed.data;

    const config = await db.slackConfig.upsert({
      where: { workspaceId },
      create: {
        workspaceId,
        workspaceName: workspaceName ?? null,
        botToken,
        signingSecret,
        channelId: channelId ?? null,
      },
      update: {
        workspaceName: workspaceName ?? null,
        botToken,
        signingSecret,
        channelId: channelId ?? null,
      },
    });

    // Return masked version
    return ok({
      id: config.id,
      workspaceId: config.workspaceId,
      workspaceName: config.workspaceName,
      botToken: "****" + config.botToken.slice(-4),
      signingSecret: "****" + config.signingSecret.slice(-4),
      channelId: config.channelId,
      createdAt: config.createdAt.toISOString(),
      updatedAt: config.updatedAt.toISOString(),
    });
  } catch (e) {
    return serverError(e);
  }
}

// ── DELETE ────────────────────────────────────────────────────────────────────

export async function DELETE() {
  try {
    const configs = await db.slackConfig.findMany({ take: 1 });
    if (configs.length === 0) {
      return notFound("No Slack configuration found");
    }
    await db.slackConfig.delete({ where: { id: configs[0].id } });
    return ok({ deleted: true });
  } catch (e) {
    return serverError(e);
  }
}

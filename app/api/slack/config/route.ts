/**
 * GET /api/slack/config   — return current config (secrets masked) + socket status
 * POST /api/slack/config  — upsert config, auto-start Socket Mode if appToken provided
 * DELETE /api/slack/config — remove config, stop Socket Mode
 */
import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { ok, err, notFound, serverError } from "@/lib/api-helpers";
import { getSlackConfig } from "@/lib/slack";
import { startSocketMode, stopSocketMode, isSocketModeRunning } from "@/lib/slack-socket";

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
  signingSecret: z.string().optional(),
  appToken: z
    .string()
    .optional()
    .refine((v) => !v || v.startsWith("xapp-"), {
      message: "appToken must start with xapp-",
    }),
  channelId: z.string().optional(),
});

// ── GET ───────────────────────────────────────────────────────────────────────

export async function GET() {
  try {
    const config = await getSlackConfig();
    if (!config) {
      return notFound("No Slack configuration found");
    }
    return ok({
      ...config,
      socketConnected: isSocketModeRunning(),
    });
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

    const { workspaceId, workspaceName, botToken, signingSecret, appToken, channelId } =
      parsed.data;

    const config = await db.slackConfig.upsert({
      where: { workspaceId },
      create: {
        workspaceId,
        workspaceName: workspaceName ?? null,
        botToken,
        signingSecret: signingSecret ?? null,
        appToken: appToken ?? null,
        channelId: channelId ?? null,
      },
      update: {
        workspaceName: workspaceName ?? null,
        botToken,
        signingSecret: signingSecret ?? null,
        appToken: appToken ?? null,
        channelId: channelId ?? null,
      },
    });

    // Auto-start or stop Socket Mode based on appToken
    if (appToken) {
      try {
        await startSocketMode(appToken, botToken);
      } catch (e) {
        console.error("[slack/config] Failed to start Socket Mode:", e instanceof Error ? e.message : e);
      }
    } else {
      // No appToken — ensure Socket Mode is stopped
      await stopSocketMode();
    }

    // Return masked version
    return ok({
      id: config.id,
      workspaceId: config.workspaceId,
      workspaceName: config.workspaceName,
      botToken: "****" + config.botToken.slice(-4),
      signingSecret: config.signingSecret ? "****" + config.signingSecret.slice(-4) : null,
      appToken: config.appToken ? "****" + config.appToken.slice(-4) : null,
      channelId: config.channelId,
      socketConnected: isSocketModeRunning(),
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

    // Stop Socket Mode before deleting config
    await stopSocketMode();

    await db.slackConfig.delete({ where: { id: configs[0].id } });
    return ok({ deleted: true });
  } catch (e) {
    return serverError(e);
  }
}

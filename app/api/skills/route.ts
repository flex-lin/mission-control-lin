import { ok, serverError } from "@/lib/api-helpers";
import { listSkills } from "@/lib/claude-files";

export async function GET() {
  try {
    const skills = listSkills();
    return ok(skills, { count: skills.length });
  } catch (e) {
    return serverError(e);
  }
}

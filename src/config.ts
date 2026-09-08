import { z } from "zod";

const envSchema = z.object({
  SPLITBILL_BASE_URL: z.string().url("must be a valid URL"),
  SPLITBILL_EMAIL: z.string().email("must be a valid email"),
  SPLITBILL_PASSWORD: z.string().min(1, "Required"),
  SPLITBILL_TIMEOUT_MS: z.coerce.number().positive().default(15000),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
});

export type SplitBillConfig = z.infer<typeof envSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): SplitBillConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    throw new Error(`Invalid MCP configuration: ${details}`);
  }
  return {
    ...parsed.data,
    SPLITBILL_BASE_URL: parsed.data.SPLITBILL_BASE_URL.replace(/\/$/, ""),
  };
}

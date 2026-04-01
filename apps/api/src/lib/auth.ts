import { createAuth } from "@brett/api-core";

const isLocal = !process.env.BETTER_AUTH_URL || process.env.BETTER_AUTH_URL.includes("localhost");

export const auth = createAuth({
  trustedOrigins: isLocal
    ? (request?: Request) => {
        const origin = request?.headers.get("origin") ?? "";
        if (origin === "app://." || /^http:\/\/localhost:\d+$/.test(origin))
          return [origin];
        return [];
      }
    : [
        "app://.",
        process.env.BETTER_AUTH_URL!, // API's own origin (for desktop OAuth HTML page)
      ],
  enablePasskeys: true,
});

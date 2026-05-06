declare const process: {
  env: {
    HOST?: string;
    PORT?: string;
  };
  exit(code?: number): void;
};

import { buildApp } from "./app";

const app = await buildApp();
const port = Number(process.env.PORT ?? 3001);
const host = process.env.HOST ?? "127.0.0.1";

app.listen({ port, host }).catch((error) => {
  app.log.error(error);
  process.exit(1);
});

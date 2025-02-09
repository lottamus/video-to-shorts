import { red } from "yoctocolors";

function getLogger({ debug }: { debug?: boolean }) {
  return {
    info: (...message: unknown[]) => {
      console.info(...message);
    },

    debug: (...message: unknown[]) => {
      if (debug) {
        console.log(...message);
      }
    },

    warn: (...message: unknown[]) => {
      console.warn(...message);
    },

    error: (msg: unknown, ...message: unknown[]) => {
      console.error(red(String(msg)), ...message);
    },
  };
}

export let logger = getLogger({ debug: false });

export const createLogger = ({ debug }: { debug?: boolean }) => {
  logger = getLogger({ debug });
};

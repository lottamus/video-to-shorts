function getLogger({ debug }: { debug?: boolean }) {
  return {
    info: (...message: unknown[]) => {
      console.log(...message);
    },

    debug: (...message: unknown[]) => {
      if (debug) {
        console.log(...message);
      }
    },

    warn: (...message: unknown[]) => {
      console.warn(...message);
    },

    error: (...message: unknown[]) => {
      console.error(...message);
    },
  };
}

export let logger = getLogger({ debug: false });

export const createLogger = ({ debug }: { debug?: boolean }) => {
  logger = getLogger({ debug });
};

exports.name = 'Chain';
exports.version = '1.2';
exports.cribl_version = '3.2.0';
exports.disabled = false;
exports.handleSignals = true;
exports.group = 'Advanced'
exports.asyncTimeout = -1

let logger;

let processorId;
let signature;

const PROCESSOR_INIT_MAX_RETRY = 10;
let processorInitFailures = 0;
let processorProm;
let processor;

exports.init = opts => {
  processorProm = undefined;
  processorId = opts.conf?.processor;
  signature = `${opts.cid}:${opts.pid}${opts.pipeIdx != null ? ':' + opts.pipeIdx : ''}`;
  logger = C.util.getLogger('func:chain', {signature, processorId});
}

function isProcessorCreationMaxRetryExhausted() {
  return processorInitFailures >= PROCESSOR_INIT_MAX_RETRY;
}

exports.process = async event => {
  if (event.__signatures?.has(signature)) {
    // if already processed by the pipeline, exit early
    return event;
  }
  if (isProcessorCreationMaxRetryExhausted()) {
    return event;
  }

  if (processorProm == null || processor?.isClosed()) {
    logger?.debug('creating new processor');
    processorProm = C.internal.getEventProcessor(processorId);
  }
  if (processor == null) {
    processor = await processorProm.catch(error => {
      logger?.debug('failed to load event processor', {error, processorInitFailures});
      processorProm = undefined;
      processorInitFailures++;
      if (isProcessorCreationMaxRetryExhausted()) {
        logger?.warn('failed to load event processor too many times, no more attempts to load will be done', {maxRetries: PROCESSOR_INIT_MAX_RETRY});
      }
    });
    if (processor == null) {
      return event;
    }
  }

  event.__signatures = event.__signatures ?? new Set();
  event.__signatures.add(signature);
  return await processor.process(event);
}

exports.unload = () => {
  logger?.info('closing processor');
  processorInitFailures = 0;
  processorProm = undefined;
  processor?.close();
}

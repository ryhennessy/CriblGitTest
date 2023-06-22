/* eslint-disable no-await-in-loop */

exports.name = 'Database';
exports.version = '0.1';
exports.disabled = false;
exports.destroyable = false;

let conf;
let queryExpression;

const isSelect = (query) => {
  const queries = query.split(';');
  if (queries.length > 2 || (queries.length === 2 && queries[1].trim() !== '')) {
    return false;
  }
  return query.trim().toLowerCase().startsWith('select');
}

exports.init = async (opts) => {
  const { Expression } = C.expr;

  conf = opts.conf || {};

  queryExpression = new Expression(conf.query, {disallowAssign: true});
  if (!isSelect(queryExpression.evalOn({}))) {
    throw new Error('Invalid config - Must provide only a single SELECT query');
  }
};

exports.discover = async (job) => {
  await job.addResult({});
};

exports.collect = async (collectible, job) => {
  const connection = conf.connectionId;
  const databaseConnectionsMgr = C.internal.DatabaseConnectionsMgr.instance();
  let client;
  try {
    client = databaseConnectionsMgr.getConnection(connection, job.logger());
  } catch (err) {
    job.reportError(err);
  }

  if (client == null) {
    throw new Error(`Can't find Database Connection '${connection}'`);
  }

  const preparedStatement = client.prepareStatement(queryExpression);

  if (preparedStatement) {
    const args = {};
    try {
      // We need to check for NaN for earliest and latest since they're set to the string "(Date.now() / 1000)" if user enters 'now'
      if (queryExpression.references("earliest")) {
        args['earliest'] = new Date(isNaN(+conf.earliest) ? Date.now() : conf.earliest * 1000).toISOString();
      }
      if (queryExpression.references("latest")) {
        args['latest'] = new Date(isNaN(+conf.latest) ? Date.now() : conf.latest * 1000).toISOString();
      }
      job.logger().debug('Query', { preparedStatement, args });

      const query = await client.executeQuery(preparedStatement, args);
      const readable = await C.util.stringifyReadableObjects(query);

      return readable;
    } catch (err) {
      job.reportError(new Error('Collect error', { err })).catch(() => {});
      throw err;
    }
  } else {
    job.reportError(new Error('Unable to prepare statement', { queryExpression })).catch(() => {});
  }
};

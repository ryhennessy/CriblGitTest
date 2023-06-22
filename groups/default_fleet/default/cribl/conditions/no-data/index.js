exports.name = 'No Data Received';
exports.type = 'metric';
exports.category = 'sources';

let name;
let __workerGroup;
let timeWindow;

exports.init = (opts) => {
  const conf = opts.conf || {};
  ({
    name,
    __workerGroup,
    timeWindow
  } = conf);
  timeWindow = timeWindow || '60s';
};

exports.build = () => {
  let filter = `(_metric === 'total.in_bytes' || _metric === 'health.inputs') && input === '${name}'`;
  let _raw = `'Source ${name} had no traffic for ${timeWindow}'`;
  const add = [
    { name: 'input', value: `'${name}'`},
    { name: '_metric', value: `'total.in_bytes'`},
  ];
  if(__workerGroup) {
    filter = `(${filter}) && __worker_group === '${__workerGroup}'`;
    _raw = `'Source ${name} in group ${__workerGroup} had no traffic for ${timeWindow}'`;
  }
  add.push({name: '_raw', value: _raw});

  return {
    filter,
    pipeline: {
      conf: {
        functions: [
          {
            id: 'aggregation',
            conf: {
              timeWindow,
              aggregations: [
                "sum(_value).where(_metric==='total.in_bytes').as(bytes)",
                "perc(95, _value).where(_metric==='health.inputs').as(health)"
              ],
              lagTolerance: '20s',
              idleTimeLimit: '20s',
            }
          },
          {
            id: 'drop',
            filter: 'bytes > 0',
          },
          {
            id: 'eval',
            conf: {
              add
            }
          }
        ]
      }
    }
  };
}
exports.name = 'Low Data Volume';
exports.type = 'metric';
exports.category = 'sources';

let name;
let __workerGroup;
let timeWindow;
let dataVolumeBytes;
let dataVolume;

exports.init = (opts) => {
  const conf = opts.conf || {};
  ({
    name,
    __workerGroup,
    timeWindow,
    dataVolume,
  } = conf);
  timeWindow = timeWindow || '60s';
  
  dataVolume = dataVolume || '1KB';
  dataVolumeBytes = C.util.parseMemoryStringToBytes(dataVolume, err => { throw err; });
};

exports.build = () => {
  let filter = `(_metric === 'total.in_bytes' || _metric === 'health.inputs') && input === '${name}'`;
  let _raw = `'Source ${name} traffic volume less than ${dataVolume} in ${timeWindow}'`;
  const add = [
    { name: 'input', value: `'${name}'`},
    { name: '_metric', value: `'total.in_bytes'`},
  ];
  if(__workerGroup) {
    filter = `(${filter}) && __worker_group === '${__workerGroup}'`;
    _raw = `'Source ${name} in group ${__workerGroup} traffic volume less than ${dataVolume} in ${timeWindow}'`;
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
              dataVolume,
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
            filter: `bytes > ${dataVolumeBytes}`,
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
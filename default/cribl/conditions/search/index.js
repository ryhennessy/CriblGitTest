exports.name = 'Search Condition';
exports.type = 'message';
exports.category = 'search';

exports.init = (opts) => {};
exports.build = () => ({
  filter: `id === 'SEARCH_NOTIFICATION'`,
  pipeline: {
    conf: {
      functions: [], // passthru
    },
  },
});

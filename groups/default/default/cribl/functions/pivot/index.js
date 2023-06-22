/**
 * Cribl-internal function to perform a simple pivot of potentially aggregated
 * data. This is not to be confused with the Kusto pivot functionality.
 */
exports.name = 'Pivot';
exports.version = '0.1';
exports.handleSignals = true;
exports.group = C.INTERNAL_FUNCTION_GROUP;

const NULL_FIELD = 'null'; // text to be used for "null" content
let labelField; // field to bucket all data on (left-most column)
let dataFields; // fields that provide the cell values (i.e. aggregates)
let qualifierFields; // group-by values (each group has one data field)
let sourceEvents; // intermediate store for all input (aggregate-) events
let qualifierValues; // values of qualifierFields
let separator; // separator between data field(s) and qualifiers

/**
 * Initializes and configures the simple pivot function.
 * @param {*} opts The options for the pipeline function
 */
exports.init = (opts) => {
  const conf = opts.conf || {};
  labelField = conf.labelField;
  dataFields = conf.dataFields;
  qualifierFields = conf.qualifierFields;
  sourceEvents = [];
  qualifierValues = new Map(); // key: string = fieldName: value: Set with values
  separator = dataFields.length > 1 ? ': ' : '';
};

/**
 * Processes a single event at a time.
 * This pipeline function just collects all events until it is asked to flush
 * the data via signal event. It pivots the data around the configured pivot
 * field before flushing all output events at once.
 * @param {*} event The event to collect (or signal for flush)
 * @returns Null on data event or array of events when flushing
 */
exports.process = (event) => {
  if (!event) return event;

  // get rid of so far collected data upon reset
  if (needsReset(event)) {
    sourceEvents = [];
    return event;
  }

  if (event.__signalEvent__) {
    // on final: dump all input events in pivoted form
    return [...pivotSourceData(), event];
  }

  sourceEvents.push(event); // collect the event (to be pivoted on final)

  // store the different values for all qualifier fields
  for (let qualifierIdx = 0; qualifierIdx < qualifierFields.length; ++qualifierIdx) {
    const qualifierField = qualifierFields[qualifierIdx];
    const qualifierValue = event[qualifierField] ?? NULL_FIELD;
    let qualifierValueSet = qualifierValues.get(qualifierField);
    if (!qualifierValueSet) {
      qualifierValueSet = new Set();
      qualifierValues.set(qualifierField, qualifierValueSet);
    }
    qualifierValueSet.add(qualifierValue);
  }

  return null; // drop the original input event
};

/**
 * Checks if the event is a (signal-)reset event.
 * A Reset event might be sent by partial aggregation to trigger the complete
 * replacement of the output data with a new version of the data.
 * @param {*} event The event to check
 * @returns True if the event is a reset event
 */
function needsReset(event) {
  return event.__signalEvent__ === 'reset';
}

/**
 * Transforms the collected (aggregation-)source events into pivoted version.
 * @returns Array of (pivoted) output events
 */
function pivotSourceData() {
  if (!sourceEvents.length) return [];

  // generate a list of all column-name combinations
  const allFieldsNames = generateFieldNames();

  let pivotedRows = [];
  let pivotedRowsByLabel = new Map();
  for (let sourceIdx = 0; sourceIdx < sourceEvents.length; ++sourceIdx) {
    const sourceEvent = sourceEvents[sourceIdx];
    const sourceLabel = sourceEvent[labelField] || '';

    // get (or produce) the pivoted rows with value combinations
    let pivotRow = pivotedRows[pivotedRows.length - 1]; // try last row first
    if (pivotRow?.[labelField] !== sourceLabel) { 
      pivotRow = pivotedRowsByLabel.get(sourceLabel);
      if (!pivotRow) {
        pivotRow = sourceEvent.__clone(false, []);
        pivotRow[labelField] = sourceLabel;
        pivotedRowsByLabel.set(sourceLabel, pivotRow);
        pivotedRows.push(pivotRow);

        // populate new row with all fields
        for (const fieldName of allFieldsNames) {
          pivotRow[fieldName] = 0;
        }
      }
    }

    // copy the data fields into the pivoted row
    for (let dataFieldIdx = 0; dataFieldIdx < dataFields.length; ++dataFieldIdx) {
      let fieldName = dataFields.length > 1 ? dataFields[dataFieldIdx] : '';

      // put it in for the right qualifier (defining the field name)
      for (let qualifierIdx = 0; qualifierIdx < qualifierFields.length; ++qualifierIdx) {
        const qualifierField = qualifierFields[qualifierIdx];
        const qualifierValue = sourceEvent[qualifierField] || NULL_FIELD;
        fieldName = `${fieldName}${qualifierIdx ? ', ' : separator}${qualifierValue}`;
      }

      pivotRow[fieldName] = sourceEvent[dataFields[dataFieldIdx]];
    }
  }

  sourceEvents = [];
  return pivotedRows;
}

// generates the field-names based on the permutations of data field names and
// qualifiers. returns an array of all data field names that should be present
// in the output events.
function generateFieldNames() {
  const ret = [];

  // prefix fields with data field names (if multiple data fields)
  for (let dataFieldIdx = 0; dataFieldIdx < dataFields.length; ++dataFieldIdx) {
    let concatFieldNames = [dataFields.length > 1 ? dataFields[dataFieldIdx] : ''];

    // append the qualifier values (not field names)
    for (let qualifierIdx = 0; qualifierIdx < qualifierFields.length; ++qualifierIdx) {
      const qualifierField = qualifierFields[qualifierIdx];
      const qualifierValueSet = qualifierValues.get(qualifierField);
      const permutations = [];
      for (const fieldNames of concatFieldNames) {
        for (const nextQualifier of qualifierValueSet) {
          permutations.push(`${fieldNames}${qualifierIdx ? ', ' : separator}${nextQualifier}`);
        }
      }
      concatFieldNames = permutations;
    }

    ret.push(...concatFieldNames);
  }

  return ret;
}

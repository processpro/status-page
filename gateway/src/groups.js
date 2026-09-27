'use strict';

const GROUPS = [
  {
    id: 'regions',
    label: 'Regions',
    hint: 'Shared regional sites',
    visibility: 'public',
  },
  {
    id: 'products',
    label: 'Other products',
    hint: 'Shared products',
    visibility: 'public',
  },
  {
    id: 'australia',
    label: 'Australia',
    hint: 'pp-au',
    visibility: 'internal',
  },
  {
    id: 'demo',
    label: 'Demo',
    hint: 'pp-demo',
    visibility: 'internal',
  },
  {
    id: 'europe',
    label: 'Europe',
    hint: 'pp-eu',
    visibility: 'internal',
  },
  {
    id: 'canada',
    label: 'Canada',
    hint: 'pp-ca',
    visibility: 'internal',
  },
  {
    id: 'united-states',
    label: 'United States',
    hint: 'pp-us',
    visibility: 'internal',
  },
];

function groupById(id) {
  return GROUPS.find((group) => group.id === id) || null;
}

module.exports = {
  GROUPS,
  groupById,
};

export const integrationCatalog = [
  {
    id: "apple-health",
    name: "Apple Health",
    kind: "health_sync",
    status: "planned",
    dataTypes: ["glucose", "activity", "sleep", "heart_rate"]
  },
  {
    id: "dexcom",
    name: "Dexcom API",
    kind: "cgm",
    status: "planned",
    dataTypes: ["glucose", "trend"]
  },
  {
    id: "abbott-libre-linkup",
    name: "Abbott LibreLinkUp API",
    kind: "cgm",
    status: "planned",
    dataTypes: ["glucose", "trend"]
  },
  {
    id: "garmin",
    name: "Garmin activity sync",
    kind: "activity",
    status: "planned",
    dataTypes: ["exercise", "heart_rate", "recovery"]
  },
  {
    id: "oura",
    name: "Oura sleep sync",
    kind: "sleep",
    status: "planned",
    dataTypes: ["sleep", "readiness", "temperature"]
  }
];

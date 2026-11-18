export interface SaaSAppDefinition {
  id: "snapshot" | "parking"
  name: string
  tagline: string
  description: string
  badge: string
  accentColor: string
  status: "ACTIVE" | "COMING_SOON"
}

export const SAAS_APPS: SaaSAppDefinition[] = [
  {
    id: "snapshot",
    name: "ANPR Snapshot Studio",
    tagline: "Single-Image OCR & RTO Syntax Inspector",
    description:
      "Upload vehicle images for instant license plate localization, Indian RTO validation, and confidence scoring.",
    badge: "Vision Core",
    accentColor: "blue",
    status: "ACTIVE"
  },
  {
    id: "parking",
    name: "Parking & Access Control",
    tagline: "Zero-Touch Gate Automation & Tariff Management",
    description:
      "Manage Entry/Exit boom barriers, Whitelist/Blacklist vehicle rules, live slot occupancy, and automated visitor billing.",
    badge: "Smart Mobility",
    accentColor: "emerald",
    status: "ACTIVE"
  }
]
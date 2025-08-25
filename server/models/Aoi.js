// server/models/Aoi.js
const mongoose = require("mongoose");

const GeoJSONSchema = new mongoose.Schema(
  {
    type: { type: String, enum: ["Point", "Polygon", "MultiPolygon"], required: true },
    coordinates: { type: Array, required: true },
  },
  { _id: false }
);

const AoiSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true, index: true },
    name: { type: String, default: "" },
    description: { type: String, default: "" },
    geometry: { type: GeoJSONSchema, required: true },
  },
  { timestamps: true }
);

// 2dsphere index so GeoJSON queries work
AoiSchema.index({ geometry: "2dsphere" });

module.exports = mongoose.models.Aoi || mongoose.model("Aoi", AoiSchema);
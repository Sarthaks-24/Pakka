import mongoose from "mongoose";

const { Schema } = mongoose;

const TurnSchema = new Schema(
  {
    speaker: { type: String, enum: ["seller", "buyer"], required: true },
    lang: String,
    source: { type: String, enum: ["voice", "text"] },
    transcript: String,
    translation: String,
    terms: Schema.Types.Mixed,
    ambiguities: [Schema.Types.Mixed],
    status: { type: String, enum: ["held", "released"], default: "held" },
    releasedText: String,
    audioHash: String,
    latency: { sttMs: Number, llmMs: Number, ttsMs: Number },
  },
  { _id: false },
);

const DealSessionSchema = new Schema(
  {
    status: { type: String, enum: ["open", "confirmed"], default: "open" },
    ledger: { type: Schema.Types.Mixed, required: true },
    // { turnIndex, speaker, queue: [ambiguity], resolved: [slot] } while a question is open.
    pending: { type: Schema.Types.Mixed, default: null },
    turns: [TurnSchema],
    card: { type: Schema.Types.Mixed, default: null },
  },
  {
    timestamps: true,
    minimize: false,
    toJSON: {
      transform: (_doc, ret) => {
        ret.id = String(ret._id);
        delete ret._id;
        delete ret.__v;
        return ret;
      },
    },
  },
);

export const DealSession = mongoose.models.DealSession ?? mongoose.model("DealSession", DealSessionSchema);

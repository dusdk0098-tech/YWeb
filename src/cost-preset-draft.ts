import type { readCostPreset } from "../server/cost-preset-model";
// Called only after explicit apply confirmation. Never chooses date or category.
export function costPresetDraft(preset:ReturnType<typeof readCostPreset>) {
 return {form:{categoryId:"",spendDate:"",...preset.body.defaults},source:{id:preset.body.id,version:preset.body.version,hash:preset.hash},name:preset.body.name,defaults:preset.body.defaults};
}

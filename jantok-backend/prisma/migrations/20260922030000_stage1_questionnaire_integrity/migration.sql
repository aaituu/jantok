-- A completed questionnaire must contain every input consumed by the engine.
ALTER TABLE "member_profiles" ADD CONSTRAINT "completed_questionnaire_inputs_required" CHECK (
  questionnaire_completed_at IS NULL OR (
    height_cm IS NOT NULL
    AND weight_kg IS NOT NULL
    AND activity_level_id IS NOT NULL
    AND goal IS NOT NULL
    AND diet_type_id IS NOT NULL
    AND allergy_declaration_status <> 'NOT_ANSWERED'
  )
);

import { loadVerbConjugations } from '../tts/verb-conjugations';

// Local enum definitions (previously from Prisma)
export enum POV {
  FIRST_PERSON = 'FIRST_PERSON',
  SECOND_PERSON = 'SECOND_PERSON',
  THIRD_PERSON = 'THIRD_PERSON',
  FIRST_PERSON_PLURAL = 'FIRST_PERSON_PLURAL',
}

export enum Gender {
  M = 'M',
  F = 'F',
  NONE = 'NONE',
}

export interface RenderContext {
  // Subject (user) settings
  subjectPOV: POV;
  subjectName?: string;
  subjectGender: Gender;

  // Dominant settings
  dominantPOV: POV;
  dominantName?: string;
  dominantGender: Gender;
  dominantTitle?: string; // Master/Mistress/etc
}

export class TemplateRenderer {
  private verbConjugations: Map<string, string[]>;

  constructor() {
    this.verbConjugations = loadVerbConjugations();
  }

  /**
   * Render a template string with the given context
   */
  render(template: string, context: RenderContext): string {
    let result = template;

    // Replace variables
    result = this.replaceVariables(result, context);

    // Process verb conjugations
    result = this.processVerbConjugations(result, context);

    return result;
  }

  private replaceVariables(template: string, context: RenderContext): string {
    const replacements = this.getReplacements(context);

    let result = template;
    for (const [variable, value] of Object.entries(replacements)) {
      const pattern = new RegExp(`\\{${variable}\\}`, 'g');
      result = result.replace(pattern, value);
    }

    return result;
  }

  private getReplacements(context: RenderContext): Record<string, string> {
    const replacements: Record<string, string> = {};

    // Subject replacements based on POV
    switch (context.subjectPOV) {
      case POV.FIRST_PERSON:
        replacements.subject_subjective = 'I';
        replacements.subject_objective = 'me';
        replacements.subject_possessive = 'my';
        break;
      case POV.SECOND_PERSON:
        replacements.subject_subjective = 'you';
        replacements.subject_objective = 'you';
        replacements.subject_possessive = 'your';
        break;
      case POV.THIRD_PERSON:
        if (context.subjectName) {
          replacements.subject_subjective = context.subjectName;
          replacements.subject_objective = context.subjectName;
          replacements.subject_possessive = `${context.subjectName}'s`;
        } else {
          const pronouns = this.getThirdPersonPronouns(context.subjectGender);
          replacements.subject_subjective = pronouns.subjective;
          replacements.subject_objective = pronouns.objective;
          replacements.subject_possessive = pronouns.possessive;
        }
        break;
      case POV.FIRST_PERSON_PLURAL:
        replacements.subject_subjective = 'we';
        replacements.subject_objective = 'us';
        replacements.subject_possessive = 'our';
        break;
    }

    // Subject name (always available if provided)
    if (context.subjectName) {
      replacements.subject_name = context.subjectName;
    }

    // Dominant replacements based on POV
    switch (context.dominantPOV) {
      case POV.FIRST_PERSON:
        replacements.dominant_subjective = 'I';
        replacements.dominant_objective = 'me';
        replacements.dominant_possessive = 'my';
        break;
      case POV.SECOND_PERSON:
        replacements.dominant_subjective = 'you';
        replacements.dominant_objective = 'you';
        replacements.dominant_possessive = 'your';
        break;
      case POV.THIRD_PERSON:
        if (context.dominantName) {
          replacements.dominant_subjective = context.dominantName;
          replacements.dominant_objective = context.dominantName;
          replacements.dominant_possessive = `${context.dominantName}'s`;
        } else {
          const pronouns = this.getThirdPersonPronouns(context.dominantGender);
          replacements.dominant_subjective = pronouns.subjective;
          replacements.dominant_objective = pronouns.objective;
          replacements.dominant_possessive = pronouns.possessive;
        }
        break;
      case POV.FIRST_PERSON_PLURAL:
        replacements.dominant_subjective = 'we';
        replacements.dominant_objective = 'us';
        replacements.dominant_possessive = 'our';
        break;
    }

    // Dominant name and title
    if (context.dominantName) {
      replacements.dominant_name = context.dominantName;
    }
    if (context.dominantTitle) {
      replacements.dominant_title = context.dominantTitle;
    }

    // Gender nouns
    replacements.subject_gender_noun = this.getGenderNoun(context.subjectGender);
    replacements.dominant_gender_noun = this.getGenderNoun(context.dominantGender);

    return replacements;
  }

  private getThirdPersonPronouns(gender: Gender) {
    switch (gender) {
      case Gender.M:
        return { subjective: 'he', objective: 'him', possessive: 'his' };
      case Gender.F:
        return { subjective: 'she', objective: 'her', possessive: 'her' };
      default:
        return { subjective: 'they', objective: 'them', possessive: 'their' };
    }
  }

  private getGenderNoun(gender: Gender): string {
    switch (gender) {
      case Gender.M:
        return 'boy';
      case Gender.F:
        return 'girl';
      default:
        return 'one';
    }
  }

  private processVerbConjugations(template: string, context: RenderContext): string {
    // Match verb conjugation patterns like [trust|trusts]
    const verbPattern = /\[([^|]+)\|([^|]+)(?:\|([^|]+))?(?:\|([^|\]]+))?\]/g;

    return template.replace(verbPattern, (match, form1, form2, form3, form4) => {
      // Determine which form to use based on the preceding subject
      const precedingText = template.substring(0, template.indexOf(match));

      // Check what subject precedes this verb
      if (precedingText.endsWith('I ') || precedingText.endsWith('{subject_subjective} ') && context.subjectPOV === POV.FIRST_PERSON) {
        return form1; // First person singular
      } else if (precedingText.endsWith('we ') || precedingText.endsWith('{subject_subjective} ') && context.subjectPOV === POV.FIRST_PERSON_PLURAL) {
        return form2 || form1; // First person plural (or fallback)
      } else if (precedingText.endsWith('you ') ||
                 (precedingText.endsWith('{subject_subjective} ') && context.subjectPOV === POV.SECOND_PERSON) ||
                 (precedingText.endsWith('{dominant_subjective} ') && context.dominantPOV === POV.SECOND_PERSON)) {
        return form3 || form2 || form1; // Second person
      } else {
        // Third person (he/she/they/name)
        return form4 || form2; // Third person singular or default to second form
      }
    });
  }

  /**
   * Generate a hash for the rendered text (for caching)
   * Uses browser-native SubtleCrypto API
   */
  static async generateHash(text: string): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(text);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }
}

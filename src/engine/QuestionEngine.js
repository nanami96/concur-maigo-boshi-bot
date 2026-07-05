export default class QuestionEngine {
  constructor(config) {
    this.config = config;

    this.currentQuestion = null;
    this.answers = [];
  }

  getFirstQuestion() {
    this.currentQuestion = this.config.questions[0];
    return this.currentQuestion;
  }
  submitAnswer(answer) {
    this.answers.push({
      questionId: this.currentQuestion.id,
      answer,
    });

    const selectedOption = this.currentQuestion.options.find(
      (option) => option.value === answer,
    );

    if (!selectedOption) {
      return null;
    }

    if (!selectedOption.nextQuestionId) {
      return null;
    }

    this.currentQuestion = this.config.questions.find(
      (question) => question.id === selectedOption.nextQuestionId,
    );

    return this.currentQuestion;
  }
  getResult() {
    const matchedRule = this.config.rules
      .filter((rule) => rule.active)
      .sort((a, b) => a.priority - b.priority)
      .find((rule) =>
        Object.entries(rule.conditions).every(([questionId, answer]) =>
          this.answers.some(
            (item) => item.questionId === questionId && item.answer === answer,
          ),
        ),
      );

    if (!matchedRule) {
      return null;
    }

    const expenseType = this.config.expenseTypes.find(
      (item) => item.id === matchedRule.resultExpenseTypeId,
    );

    return {
      rule: matchedRule,
      expenseType,
    };
  }
}

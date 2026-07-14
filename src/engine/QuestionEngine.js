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
    const matchedRules = this.config.rules
      .filter((rule) => rule.active)
      .sort((a, b) => a.priority - b.priority)
      .filter((rule) =>
        Object.entries(rule.conditions).every(([questionId, answer]) =>
          this.answers.some(
            (item) => item.questionId === questionId && item.answer === answer,
          ),
        ),
      );

    if (matchedRules.length === 0) {
      return null;
    }

    const toResult = (rule) => ({
      rule,
      expenseType: this.config.expenseTypes.find(
        (item) => item.id === rule.resultExpenseTypeId,
      ),
    });

    if (matchedRules.length === 1) {
      return toResult(matchedRules[0]);
    }

    return { candidates: matchedRules.map(toResult) };
  }
  getSnapshot() {
    return {
      currentQuestion: this.currentQuestion,
      answers: [...this.answers],
    };
  }

  restoreSnapshot(snapshot) {
    this.currentQuestion = snapshot.currentQuestion;
    this.answers = [...snapshot.answers];

    return this.currentQuestion;
  }

  reset() {
    this.currentQuestion = null;
    this.answers = [];

    return this.getFirstQuestion();
  }
}

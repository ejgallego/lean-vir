import Vir.GeneratePackage.Frontend

#eval IO.println "VIR_GENERATOR_EVAL_SINGLE"
#eval! IO.println "VIR_GENERATOR_EVAL_BANG"

#eval
  IO.println "VIR_GENERATOR_EVAL_MULTILINE"

#eval (do
  let message := "VIR_GENERATOR_EVAL_NESTED"
  IO.println message)

/-
#eval IO.println "VIR_GENERATOR_EVAL_COMMENT"
-/

def evalSourceText : String := r#"before
#eval IO.println "VIR_GENERATOR_EVAL_STRING"
after"#

example : evalSourceText = "before\n#eval IO.println \"VIR_GENERATOR_EVAL_STRING\"\nafter" := rfl

def evalSourceValue : Nat := 42

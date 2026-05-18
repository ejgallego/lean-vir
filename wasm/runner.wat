(module
  (import "wasi_snapshot_preview1" "proc_exit" (func $proc_exit (param i32)))

  (func $_start (export "_start"))

  ;; WAT fallback for machines without wasm-ld. It follows the Lean IR emitted
  ;; for examples/Fib.lean: Nat.decEq, Nat.sub, recursive fib calls, Nat.add.
  (func $fib (export "vir_fib") (param $x_1 i32) (result i32)
    (local $x_2 i32)
    (local $x_3 i32)
    (local $x_4 i32)
    (local $x_5 i32)
    (local $x_6 i32)
    (local $x_7 i32)
    (local $x_8 i32)
    (local $x_9 i32)
    (local $x_10 i32)
    (local $x_11 i32)

    i32.const 0
    local.set $x_2

    local.get $x_1
    local.get $x_2
    i32.eq
    local.set $x_3

    local.get $x_3
    if (result i32)
      local.get $x_2
    else
      i32.const 1
      local.set $x_4

      local.get $x_1
      local.get $x_4
      i32.sub
      local.set $x_5

      local.get $x_5
      local.get $x_2
      i32.eq
      local.set $x_6

      local.get $x_6
      if (result i32)
        local.get $x_4
      else
        local.get $x_5
        local.get $x_4
        i32.sub
        local.set $x_7

        local.get $x_7
        call $fib
        local.set $x_8

        local.get $x_7
        local.get $x_4
        i32.add
        local.set $x_9

        local.get $x_9
        call $fib
        local.set $x_10

        local.get $x_8
        local.get $x_10
        i32.add
        local.set $x_11

        local.get $x_11
      end
    end
  )

  (func (export "vir_target_pointer_bytes") (result i32)
    i32.const 4
  )

  (func (export "vir_target_size_t_bytes") (result i32)
    i32.const 4
  )

  (func (export "vir_target_layout_ok") (result i32)
    i32.const 1
  )
)


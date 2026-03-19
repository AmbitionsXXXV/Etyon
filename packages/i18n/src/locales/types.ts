export interface TranslationTree {
  [key: string]: string | TranslationTree
}

type NestedTranslationKeyPrefix<
  Prefix extends string,
  Suffix extends string
> = `${Prefix}.${Suffix}`

export type NestedTranslationKey<TTranslationTree> =
  TTranslationTree extends string
    ? never
    : {
        [Key in keyof TTranslationTree &
          string]: TTranslationTree[Key] extends string
          ? Key
          : NestedTranslationKeyPrefix<
              Key,
              NestedTranslationKey<TTranslationTree[Key]>
            >
      }[keyof TTranslationTree & string]

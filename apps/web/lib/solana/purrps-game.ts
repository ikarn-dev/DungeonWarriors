// Generated from user-built Anchor artifacts. Regenerate with program:export-client.
import type { Idl as AnchorIdl } from "@anchor-lang/core";
/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/purrps_game.json`.
 */
export type PurrpsGame = {
  address: "F1cmavHq4562uJ8JmRPM5oFk8q28GW5hadXnZfVCCcUx";
  metadata: {
    name: "purrpsGame";
    version: "0.1.0";
    spec: "0.1.0";
    description: "PURRPS vault, wager and settlement program";
  };
  instructions: [
    {
      name: "claimStarter";
      discriminator: [142, 187, 84, 81, 84, 148, 223, 217];
      accounts: [
        {
          name: "config";
          pda: {
            seeds: [
              {
                kind: "const";
                value: [103, 97, 109, 101, 45, 99, 111, 110, 102, 105, 103];
              },
            ];
          };
        },
        {
          name: "owner";
          signer: true;
          relations: ["player", "collection"];
        },
        {
          name: "payer";
          writable: true;
          signer: true;
        },
        {
          name: "player";
          writable: true;
          pda: {
            seeds: [
              {
                kind: "const";
                value: [112, 108, 97, 121, 101, 114];
              },
              {
                kind: "account";
                path: "owner";
              },
            ];
          };
        },
        {
          name: "collection";
          writable: true;
          pda: {
            seeds: [
              {
                kind: "const";
                value: [99, 111, 108, 108, 101, 99, 116, 105, 111, 110];
              },
              {
                kind: "account";
                path: "owner";
              },
            ];
          };
        },
        {
          name: "catalog";
          pda: {
            seeds: [
              {
                kind: "const";
                value: [99, 97, 116, 97, 108, 111, 103];
              },
              {
                kind: "arg";
                path: "args.expectedCatalogVersion";
              },
            ];
          };
        },
        {
          name: "draw";
          writable: true;
          pda: {
            seeds: [
              {
                kind: "const";
                value: [100, 114, 97, 119];
              },
              {
                kind: "account";
                path: "owner";
              },
              {
                kind: "arg";
                path: "args.expectedDrawNonce";
              },
            ];
          };
        },
        {
          name: "oracleQueue";
          writable: true;
        },
        {
          name: "programIdentity";
          pda: {
            seeds: [
              {
                kind: "const";
                value: [105, 100, 101, 110, 116, 105, 116, 121];
              },
            ];
          };
        },
        {
          name: "vrfProgram";
          address: "Vrf1RNUjXmQGjmQrQLvJHs9SNkvDJEsRVFPkfSQUwGz";
        },
        {
          name: "slotHashes";
          address: "SysvarS1otHashes111111111111111111111111111";
        },
        {
          name: "systemProgram";
          address: "11111111111111111111111111111111";
        },
      ];
      args: [
        {
          name: "args";
          type: {
            defined: {
              name: "requestCapsuleArgs";
            };
          };
        },
      ];
    },
    {
      name: "createPlayer";
      discriminator: [19, 178, 189, 216, 159, 134, 0, 192];
      accounts: [
        {
          name: "config";
          pda: {
            seeds: [
              {
                kind: "const";
                value: [103, 97, 109, 101, 45, 99, 111, 110, 102, 105, 103];
              },
            ];
          };
        },
        {
          name: "owner";
          signer: true;
        },
        {
          name: "payer";
          writable: true;
          signer: true;
        },
        {
          name: "player";
          writable: true;
          pda: {
            seeds: [
              {
                kind: "const";
                value: [112, 108, 97, 121, 101, 114];
              },
              {
                kind: "account";
                path: "owner";
              },
            ];
          };
        },
        {
          name: "collection";
          writable: true;
          pda: {
            seeds: [
              {
                kind: "const";
                value: [99, 111, 108, 108, 101, 99, 116, 105, 111, 110];
              },
              {
                kind: "account";
                path: "owner";
              },
            ];
          };
        },
        {
          name: "systemProgram";
          address: "11111111111111111111111111111111";
        },
      ];
      args: [];
    },
    {
      name: "deposit";
      discriminator: [242, 35, 198, 137, 82, 225, 242, 182];
      accounts: [
        {
          name: "config";
          pda: {
            seeds: [
              {
                kind: "const";
                value: [103, 97, 109, 101, 45, 99, 111, 110, 102, 105, 103];
              },
            ];
          };
          relations: ["house"];
        },
        {
          name: "owner";
          signer: true;
          relations: ["player"];
        },
        {
          name: "player";
          writable: true;
          pda: {
            seeds: [
              {
                kind: "const";
                value: [112, 108, 97, 121, 101, 114];
              },
              {
                kind: "account";
                path: "owner";
              },
            ];
          };
        },
        {
          name: "house";
          writable: true;
          pda: {
            seeds: [
              {
                kind: "const";
                value: [104, 111, 117, 115, 101];
              },
            ];
          };
        },
        {
          name: "vault";
          writable: true;
        },
        {
          name: "ownerTokens";
          writable: true;
        },
        {
          name: "usdcMint";
          address: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";
        },
        {
          name: "tokenProgram";
          address: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
        },
      ];
      args: [
        {
          name: "args";
          type: {
            defined: {
              name: "amountArgs";
            };
          };
        },
      ];
    },
    {
      name: "fulfillStarter";
      discriminator: [114, 170, 35, 28, 32, 184, 26, 211];
      accounts: [
        {
          name: "vrfProgramIdentity";
          docs: [
            "Scoped VRF identity PDA, bound to this program. Its presence as a signer proves",
            "the callback was issued by the VRF program for this program.",
          ];
          signer: true;
        },
        {
          name: "config";
          pda: {
            seeds: [
              {
                kind: "const";
                value: [103, 97, 109, 101, 45, 99, 111, 110, 102, 105, 103];
              },
            ];
          };
        },
        {
          name: "draw";
          writable: true;
          pda: {
            seeds: [
              {
                kind: "const";
                value: [100, 114, 97, 119];
              },
              {
                kind: "account";
                path: "draw.owner";
                account: "capsuleDraw";
              },
              {
                kind: "account";
                path: "draw.nonce";
                account: "capsuleDraw";
              },
            ];
          };
        },
        {
          name: "collection";
          writable: true;
          pda: {
            seeds: [
              {
                kind: "const";
                value: [99, 111, 108, 108, 101, 99, 116, 105, 111, 110];
              },
              {
                kind: "account";
                path: "draw.owner";
                account: "capsuleDraw";
              },
            ];
          };
        },
        {
          name: "catalog";
          pda: {
            seeds: [
              {
                kind: "const";
                value: [99, 97, 116, 97, 108, 111, 103];
              },
              {
                kind: "account";
                path: "draw.catalog.version";
                account: "capsuleDraw";
              },
            ];
          };
        },
      ];
      args: [
        {
          name: "randomness";
          type: {
            array: ["u8", 32];
          };
        },
        {
          name: "seed";
          type: {
            array: ["u8", 32];
          };
        },
      ];
    },
    {
      name: "fundHouse";
      discriminator: [175, 231, 49, 44, 144, 102, 41, 69];
      accounts: [
        {
          name: "config";
          pda: {
            seeds: [
              {
                kind: "const";
                value: [103, 97, 109, 101, 45, 99, 111, 110, 102, 105, 103];
              },
            ];
          };
          relations: ["house"];
        },
        {
          name: "admin";
          signer: true;
          relations: ["config"];
        },
        {
          name: "house";
          writable: true;
          pda: {
            seeds: [
              {
                kind: "const";
                value: [104, 111, 117, 115, 101];
              },
            ];
          };
        },
        {
          name: "vault";
          writable: true;
        },
        {
          name: "adminTokens";
          writable: true;
        },
        {
          name: "usdcMint";
          address: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";
        },
        {
          name: "tokenProgram";
          address: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
        },
      ];
      args: [
        {
          name: "args";
          type: {
            defined: {
              name: "amountArgs";
            };
          };
        },
      ];
    },
    {
      name: "increment";
      discriminator: [11, 18, 104, 9, 104, 174, 59, 33];
      accounts: [
        {
          name: "counter";
          writable: true;
          pda: {
            seeds: [
              {
                kind: "const";
                value: [99, 111, 117, 110, 116, 101, 114];
              },
            ];
          };
        },
        {
          name: "authority";
          signer: true;
        },
      ];
      args: [];
    },
    {
      name: "initialize";
      discriminator: [175, 175, 109, 31, 13, 152, 155, 237];
      accounts: [
        {
          name: "payer";
          writable: true;
          signer: true;
        },
        {
          name: "counter";
          writable: true;
          pda: {
            seeds: [
              {
                kind: "const";
                value: [99, 111, 117, 110, 116, 101, 114];
              },
            ];
          };
        },
        {
          name: "systemProgram";
          address: "11111111111111111111111111111111";
        },
      ];
      args: [];
    },
    {
      name: "initializeConfig";
      discriminator: [208, 127, 21, 1, 194, 190, 196, 70];
      accounts: [
        {
          name: "program";
          address: "F1cmavHq4562uJ8JmRPM5oFk8q28GW5hadXnZfVCCcUx";
        },
        {
          name: "programData";
        },
        {
          name: "admin";
          writable: true;
          signer: true;
        },
        {
          name: "config";
          writable: true;
          pda: {
            seeds: [
              {
                kind: "const";
                value: [103, 97, 109, 101, 45, 99, 111, 110, 102, 105, 103];
              },
            ];
          };
        },
        {
          name: "usdcMint";
          address: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";
        },
        {
          name: "tokenProgram";
          address: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
        },
        {
          name: "systemProgram";
          address: "11111111111111111111111111111111";
        },
      ];
      args: [
        {
          name: "args";
          type: {
            defined: {
              name: "initializeConfigArgs";
            };
          };
        },
      ];
    },
    {
      name: "initializeHouse";
      discriminator: [180, 46, 86, 125, 135, 107, 214, 28];
      accounts: [
        {
          name: "config";
          pda: {
            seeds: [
              {
                kind: "const";
                value: [103, 97, 109, 101, 45, 99, 111, 110, 102, 105, 103];
              },
            ];
          };
        },
        {
          name: "admin";
          writable: true;
          signer: true;
          relations: ["config"];
        },
        {
          name: "house";
          writable: true;
          pda: {
            seeds: [
              {
                kind: "const";
                value: [104, 111, 117, 115, 101];
              },
            ];
          };
        },
        {
          name: "vault";
          writable: true;
          pda: {
            seeds: [
              {
                kind: "account";
                path: "house";
              },
              {
                kind: "account";
                path: "tokenProgram";
              },
              {
                kind: "account";
                path: "usdcMint";
              },
            ];
            program: {
              kind: "const";
              value: [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89,
              ];
            };
          };
        },
        {
          name: "usdcMint";
          address: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";
        },
        {
          name: "tokenProgram";
          address: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
        },
        {
          name: "associatedTokenProgram";
          address: "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
        },
        {
          name: "systemProgram";
          address: "11111111111111111111111111111111";
        },
      ];
      args: [];
    },
    {
      name: "inspectOracle";
      discriminator: [13, 147, 53, 187, 95, 3, 159, 245];
      accounts: [
        {
          name: "config";
          pda: {
            seeds: [
              {
                kind: "const";
                value: [103, 97, 109, 101, 45, 99, 111, 110, 102, 105, 103];
              },
            ];
          };
        },
        {
          name: "priceUpdate";
          docs: [
            "are validated by inspect_account; this instruction mutates no state.",
          ];
        },
      ];
      args: [
        {
          name: "market";
          type: {
            defined: {
              name: "market";
            };
          };
        },
      ];
      returns: {
        defined: {
          name: "inspectedOracle";
        };
      };
    },
    {
      name: "inspectRun";
      discriminator: [42, 235, 206, 25, 145, 139, 255, 24];
      accounts: [
        {
          name: "run";
          pda: {
            seeds: [
              {
                kind: "const";
                value: [114, 117, 110, 45, 103, 97, 109, 101];
              },
              {
                kind: "account";
                path: "run.snapshot.owner";
                account: "runGameState";
              },
              {
                kind: "account";
                path: "run.snapshot.nonce";
                account: "runGameState";
              },
            ];
          };
        },
      ];
      args: [];
      returns: {
        defined: {
          name: "runStatusView";
        };
      };
    },
    {
      name: "inspectRunEscrow";
      discriminator: [50, 0, 92, 55, 15, 250, 129, 225];
      accounts: [
        {
          name: "escrow";
          pda: {
            seeds: [
              {
                kind: "const";
                value: [114, 117, 110, 45, 101, 115, 99, 114, 111, 119];
              },
              {
                kind: "account";
                path: "escrow.snapshot.owner";
                account: "runEscrow";
              },
              {
                kind: "account";
                path: "escrow.snapshot.nonce";
                account: "runEscrow";
              },
            ];
          };
        },
      ];
      args: [];
    },
    {
      name: "publishCatalog";
      discriminator: [66, 196, 22, 78, 35, 243, 245, 190];
      accounts: [
        {
          name: "config";
          writable: true;
          pda: {
            seeds: [
              {
                kind: "const";
                value: [103, 97, 109, 101, 45, 99, 111, 110, 102, 105, 103];
              },
            ];
          };
        },
        {
          name: "admin";
          writable: true;
          signer: true;
          relations: ["config"];
        },
        {
          name: "catalog";
          writable: true;
          pda: {
            seeds: [
              {
                kind: "const";
                value: [99, 97, 116, 97, 108, 111, 103];
              },
              {
                kind: "arg";
                path: "args.catalog.catalogVersion";
              },
            ];
          };
        },
        {
          name: "systemProgram";
          address: "11111111111111111111111111111111";
        },
      ];
      args: [
        {
          name: "args";
          type: {
            defined: {
              name: "publishCatalogArgs";
            };
          };
        },
      ];
    },
    {
      name: "publishRules";
      discriminator: [213, 245, 134, 186, 168, 25, 143, 233];
      accounts: [
        {
          name: "config";
          writable: true;
          pda: {
            seeds: [
              {
                kind: "const";
                value: [103, 97, 109, 101, 45, 99, 111, 110, 102, 105, 103];
              },
            ];
          };
        },
        {
          name: "admin";
          writable: true;
          signer: true;
          relations: ["config"];
        },
        {
          name: "rules";
          writable: true;
          pda: {
            seeds: [
              {
                kind: "const";
                value: [114, 117, 108, 101, 115];
              },
              {
                kind: "arg";
                path: "args.rules.rulesVersion";
              },
            ];
          };
        },
        {
          name: "systemProgram";
          address: "11111111111111111111111111111111";
        },
      ];
      args: [
        {
          name: "args";
          type: {
            defined: {
              name: "publishRulesArgs";
            };
          };
        },
      ];
    },
    {
      name: "selectCat";
      discriminator: [207, 232, 198, 181, 56, 52, 167, 86];
      accounts: [
        {
          name: "owner";
          signer: true;
          relations: ["collection"];
        },
        {
          name: "collection";
          writable: true;
          pda: {
            seeds: [
              {
                kind: "const";
                value: [99, 111, 108, 108, 101, 99, 116, 105, 111, 110];
              },
              {
                kind: "account";
                path: "owner";
              },
            ];
          };
        },
      ];
      args: [
        {
          name: "args";
          type: {
            defined: {
              name: "selectCatArgs";
            };
          };
        },
      ];
    },
    {
      name: "setAdmission";
      discriminator: [210, 241, 169, 64, 58, 171, 144, 234];
      accounts: [
        {
          name: "config";
          writable: true;
          pda: {
            seeds: [
              {
                kind: "const";
                value: [103, 97, 109, 101, 45, 99, 111, 110, 102, 105, 103];
              },
            ];
          };
        },
        {
          name: "admin";
          signer: true;
          relations: ["config"];
        },
      ];
      args: [
        {
          name: "args";
          type: {
            defined: {
              name: "setAdmissionArgs";
            };
          };
        },
      ];
    },
    {
      name: "setHouseBuffer";
      discriminator: [134, 174, 158, 200, 163, 103, 85, 79];
      accounts: [
        {
          name: "config";
          pda: {
            seeds: [
              {
                kind: "const";
                value: [103, 97, 109, 101, 45, 99, 111, 110, 102, 105, 103];
              },
            ];
          };
          relations: ["house"];
        },
        {
          name: "admin";
          signer: true;
          relations: ["config"];
        },
        {
          name: "house";
          writable: true;
          pda: {
            seeds: [
              {
                kind: "const";
                value: [104, 111, 117, 115, 101];
              },
            ];
          };
        },
        {
          name: "vault";
        },
      ];
      args: [
        {
          name: "args";
          type: {
            defined: {
              name: "amountArgs";
            };
          };
        },
      ];
    },
    {
      name: "withdraw";
      discriminator: [183, 18, 70, 156, 148, 109, 161, 34];
      accounts: [
        {
          name: "config";
          pda: {
            seeds: [
              {
                kind: "const";
                value: [103, 97, 109, 101, 45, 99, 111, 110, 102, 105, 103];
              },
            ];
          };
          relations: ["house"];
        },
        {
          name: "owner";
          signer: true;
          relations: ["player"];
        },
        {
          name: "player";
          writable: true;
          pda: {
            seeds: [
              {
                kind: "const";
                value: [112, 108, 97, 121, 101, 114];
              },
              {
                kind: "account";
                path: "owner";
              },
            ];
          };
        },
        {
          name: "house";
          writable: true;
          pda: {
            seeds: [
              {
                kind: "const";
                value: [104, 111, 117, 115, 101];
              },
            ];
          };
        },
        {
          name: "vault";
          writable: true;
        },
        {
          name: "ownerTokens";
          writable: true;
        },
        {
          name: "usdcMint";
          address: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";
        },
        {
          name: "tokenProgram";
          address: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
        },
      ];
      args: [
        {
          name: "args";
          type: {
            defined: {
              name: "amountArgs";
            };
          };
        },
      ];
    },
    {
      name: "withdrawSurplus";
      discriminator: [150, 183, 243, 31, 213, 21, 79, 26];
      accounts: [
        {
          name: "config";
          pda: {
            seeds: [
              {
                kind: "const";
                value: [103, 97, 109, 101, 45, 99, 111, 110, 102, 105, 103];
              },
            ];
          };
          relations: ["house"];
        },
        {
          name: "admin";
          signer: true;
          relations: ["config"];
        },
        {
          name: "house";
          writable: true;
          pda: {
            seeds: [
              {
                kind: "const";
                value: [104, 111, 117, 115, 101];
              },
            ];
          };
        },
        {
          name: "vault";
          writable: true;
        },
        {
          name: "adminTokens";
          writable: true;
        },
        {
          name: "usdcMint";
          address: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";
        },
        {
          name: "tokenProgram";
          address: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
        },
      ];
      args: [
        {
          name: "args";
          type: {
            defined: {
              name: "amountArgs";
            };
          };
        },
      ];
    },
  ];
  accounts: [
    {
      name: "capsuleDraw";
      discriminator: [213, 12, 103, 20, 228, 32, 16, 181];
    },
    {
      name: "catalogVersion";
      discriminator: [163, 239, 122, 52, 153, 145, 228, 171];
    },
    {
      name: "collection";
      discriminator: [48, 160, 232, 205, 191, 207, 26, 141];
    },
    {
      name: "counter";
      discriminator: [255, 176, 4, 245, 188, 253, 124, 25];
    },
    {
      name: "gameConfig";
      discriminator: [45, 146, 146, 33, 170, 69, 96, 133];
    },
    {
      name: "gameRulesVersion";
      discriminator: [75, 201, 160, 57, 27, 46, 192, 251];
    },
    {
      name: "houseState";
      discriminator: [160, 248, 45, 36, 81, 236, 18, 77];
    },
    {
      name: "playerAccount";
      discriminator: [224, 184, 224, 50, 98, 72, 48, 236];
    },
    {
      name: "runEscrow";
      discriminator: [167, 222, 19, 95, 231, 132, 137, 139];
    },
    {
      name: "runGameState";
      discriminator: [171, 175, 110, 104, 16, 203, 55, 131];
    },
  ];
  errors: [
    {
      code: 6000;
      name: "unauthorized";
      msg: "Only the counter authority can update this counter";
    },
    {
      code: 6001;
      name: "counterOverflow";
      msg: "Counter has reached the maximum value";
    },
    {
      code: 6002;
      name: "invalidUpgradeAuthority";
      msg: "Only the program upgrade authority can initialize configuration";
    },
    {
      code: 6003;
      name: "invalidAdmin";
      msg: "Only the configured admin can publish versions";
    },
    {
      code: 6004;
      name: "invalidConfiguration";
      msg: "Unsupported configuration schema";
    },
    {
      code: 6005;
      name: "invalidMint";
      msg: "Only official six-decimal Devnet USDC is supported";
    },
    {
      code: 6006;
      name: "invalidOracleBinding";
      msg: "Oracle identity, schema or numeric policy does not match the market";
    },
    {
      code: 6007;
      name: "invalidOracleData";
      msg: "Oracle account data is malformed or does not match its binding";
    },
    {
      code: 6008;
      name: "staleOracle";
      msg: "Oracle observation is stale";
    },
    {
      code: 6009;
      name: "invalidRules";
      msg: "Published rules must preserve the reviewed numeric contract";
    },
    {
      code: 6010;
      name: "invalidCatalog";
      msg: "Published catalog must preserve the approved product values";
    },
    {
      code: 6011;
      name: "staleVersion";
      msg: "Publication version is stale or does not advance exactly once";
    },
    {
      code: 6012;
      name: "invalidManifest";
      msg: "A nonzero version and content hash are required for media";
    },
    {
      code: 6013;
      name: "arithmeticOverflow";
      msg: "Integer range exceeded";
    },
    {
      code: 6014;
      name: "invalidAmount";
      msg: "A positive token amount is required";
    },
    {
      code: 6015;
      name: "invalidOwner";
      msg: "Token owner or player identity is invalid";
    },
    {
      code: 6016;
      name: "invalidVault";
      msg: "The custody vault is invalid or has an external delegate/close authority";
    },
    {
      code: 6017;
      name: "insufficientCredit";
      msg: "Insufficient settled available credit";
    },
    {
      code: 6018;
      name: "insolventHouse";
      msg: "The vault does not cover all obligations and the required buffer";
    },
    {
      code: 6019;
      name: "invalidRun";
      msg: "Run identity or frozen snapshot is invalid";
    },
    {
      code: 6020;
      name: "admissionClosed";
      msg: "This operation is paused or its implementation is not admitted";
    },
    {
      code: 6021;
      name: "invalidInventory";
      msg: "Inventory, draw identity or version is stale";
    },
    {
      code: 6022;
      name: "starterAlreadyClaimed";
      msg: "The starter draw is already pending or fulfilled";
    },
    {
      code: 6023;
      name: "invalidCallback";
      msg: "The callback does not match the frozen pending request";
    },
    {
      code: 6024;
      name: "invalidSession";
      msg: "Invalid or exhausted session authorization";
    },
    {
      code: 6025;
      name: "invalidSponsorBudget";
      msg: "Invalid or insufficient purpose-bound sponsor funding";
    },
  ];
  types: [
    {
      name: "acceptedIntent";
      type: {
        kind: "struct";
        fields: [
          {
            name: "envelope";
            type: {
              defined: {
                name: "intentEnvelope";
              };
            };
          },
          {
            name: "assignedTick";
            type: "u64";
          },
          {
            name: "acceptedOrder";
            type: "u64";
          },
        ];
      };
    },
    {
      name: "amountArgs";
      type: {
        kind: "struct";
        fields: [
          {
            name: "amountBaseUnits";
            type: "u64";
          },
        ];
      };
    },
    {
      name: "capsuleDraw";
      type: {
        kind: "struct";
        fields: [
          {
            name: "schemaVersion";
            type: "u16";
          },
          {
            name: "bump";
            type: "u8";
          },
          {
            name: "owner";
            type: "pubkey";
          },
          {
            name: "nonce";
            type: "u64";
          },
          {
            name: "kind";
            type: {
              defined: {
                name: "capsuleKind";
              };
            };
          },
          {
            name: "status";
            type: {
              defined: {
                name: "drawStatus";
              };
            };
          },
          {
            name: "catalog";
            type: {
              defined: {
                name: "versionBinding";
              };
            };
          },
          {
            name: "inventoryVersion";
            type: "u64";
          },
          {
            name: "eligibleMask";
            type: "u8";
          },
          {
            name: "weights";
            type: {
              array: ["u16", 4];
            };
          },
          {
            name: "totalWeight";
            type: "u16";
          },
          {
            name: "priceBaseUnits";
            type: "u64";
          },
          {
            name: "vrfProgram";
            type: "pubkey";
          },
          {
            name: "vrfQueue";
            type: "pubkey";
          },
          {
            name: "callbackAuthority";
            type: "pubkey";
          },
          {
            name: "committedSeedHash";
            type: {
              array: ["u8", 32];
            };
          },
          {
            name: "requestedAtSeconds";
            type: "i64";
          },
          {
            name: "paidDeadlineSeconds";
            type: {
              option: "i64";
            };
          },
          {
            name: "result";
            type: {
              option: {
                defined: {
                  name: "drawResult";
                };
              };
            };
          },
          {
            name: "completedAtSeconds";
            type: {
              option: "i64";
            };
          },
        ];
      };
    },
    {
      name: "capsuleKind";
      type: {
        kind: "enum";
        variants: [
          {
            name: "starterCat";
          },
          {
            name: "paidCat";
          },
          {
            name: "upgrade";
          },
        ];
      };
    },
    {
      name: "catDefinition";
      type: {
        kind: "struct";
        fields: [
          {
            name: "id";
            type: {
              defined: {
                name: "catId";
              };
            };
          },
          {
            name: "rarity";
            type: {
              defined: {
                name: "rarity";
              };
            };
          },
          {
            name: "weight";
            type: "u16";
          },
          {
            name: "power";
            type: {
              defined: {
                name: "power";
              };
            };
          },
          {
            name: "pickupRadiusBps";
            type: "u16";
          },
          {
            name: "airControlBps";
            type: "u16";
          },
          {
            name: "dashDurationBps";
            type: "u16";
          },
          {
            name: "dashCooldownBps";
            type: "u16";
          },
        ];
      };
    },
    {
      name: "catId";
      type: {
        kind: "enum";
        variants: [
          {
            name: "collector";
          },
          {
            name: "acrobat";
          },
          {
            name: "guardian";
          },
          {
            name: "sprinter";
          },
        ];
      };
    },
    {
      name: "catSnapshot";
      type: {
        kind: "struct";
        fields: [
          {
            name: "definition";
            type: {
              defined: {
                name: "catDefinition";
              };
            };
          },
          {
            name: "definingCatalog";
            type: {
              defined: {
                name: "versionBinding";
              };
            };
          },
          {
            name: "level";
            type: "u8";
          },
          {
            name: "stats";
            type: {
              defined: {
                name: "catStats";
              };
            };
          },
        ];
      };
    },
    {
      name: "catStats";
      type: {
        kind: "struct";
        fields: [
          {
            name: "power";
            type: {
              defined: {
                name: "power";
              };
            };
          },
          {
            name: "powerCooldownTicks";
            type: "u16";
          },
          {
            name: "pickupRadiusSubpixels";
            type: "i32";
          },
          {
            name: "airControlSubpixelsPerTick";
            type: "i32";
          },
          {
            name: "dashDurationTicks";
            type: "u16";
          },
          {
            name: "dashCooldownTicks";
            type: "u16";
          },
        ];
      };
    },
    {
      name: "catalog";
      type: {
        kind: "struct";
        fields: [
          {
            name: "schemaVersion";
            type: "u16";
          },
          {
            name: "catalogVersion";
            type: "u32";
          },
          {
            name: "cats";
            type: {
              array: [
                {
                  defined: {
                    name: "catDefinition";
                  };
                },
                4,
              ];
            };
          },
          {
            name: "upgrades";
            type: {
              array: [
                {
                  defined: {
                    name: "upgradeDefinition";
                  };
                },
                3,
              ];
            };
          },
          {
            name: "starterPriceBaseUnits";
            type: "u64";
          },
          {
            name: "catPriceBaseUnits";
            type: "u64";
          },
          {
            name: "upgradePriceBaseUnits";
            type: "u64";
          },
          {
            name: "maxCatLevel";
            type: "u8";
          },
          {
            name: "powerCooldownTicks";
            type: {
              array: ["u16", 5];
            };
          },
          {
            name: "magnetRadiusBps";
            type: "u16";
          },
          {
            name: "powerCharges";
            type: "u8";
          },
        ];
      };
    },
    {
      name: "catalogVersion";
      type: {
        kind: "struct";
        fields: [
          {
            name: "schemaVersion";
            type: "u16";
          },
          {
            name: "bump";
            type: "u8";
          },
          {
            name: "binding";
            type: {
              defined: {
                name: "versionBinding";
              };
            };
          },
          {
            name: "catalog";
            type: {
              defined: {
                name: "catalog";
              };
            };
          },
          {
            name: "assetManifest";
            type: {
              defined: {
                name: "versionBinding";
              };
            };
          },
        ];
      };
    },
    {
      name: "collection";
      type: {
        kind: "struct";
        fields: [
          {
            name: "schemaVersion";
            type: "u16";
          },
          {
            name: "bump";
            type: "u8";
          },
          {
            name: "owner";
            type: "pubkey";
          },
          {
            name: "inventoryVersion";
            type: "u64";
          },
          {
            name: "ownedMask";
            type: "u8";
          },
          {
            name: "cats";
            type: {
              array: [
                {
                  option: {
                    defined: {
                      name: "ownedCat";
                    };
                  };
                },
                4,
              ];
            };
          },
          {
            name: "upgradeQuantities";
            type: {
              array: ["u64", 3];
            };
          },
          {
            name: "selectedCat";
            type: {
              option: {
                defined: {
                  name: "catId";
                };
              };
            };
          },
          {
            name: "starter";
            type: {
              defined: {
                name: "starterClaim";
              };
            };
          },
          {
            name: "pendingDraw";
            type: {
              option: "pubkey";
            };
          },
        ];
      };
    },
    {
      name: "counter";
      type: {
        kind: "struct";
        fields: [
          {
            name: "count";
            type: "u64";
          },
          {
            name: "authority";
            type: "pubkey";
          },
        ];
      };
    },
    {
      name: "crankState";
      type: {
        kind: "struct";
        fields: [
          {
            name: "task";
            type: "pubkey";
          },
          {
            name: "cancelAuthority";
            type: "pubkey";
          },
          {
            name: "generation";
            type: "u64";
          },
          {
            name: "lastExecutionOrdinal";
            type: "u64";
          },
          {
            name: "trustedElapsedMs";
            type: "u64";
          },
          {
            name: "consumedElapsedMs";
            type: "u64";
          },
          {
            name: "completionAttempts";
            type: "u16";
          },
        ];
      };
    },
    {
      name: "drawResult";
      type: {
        kind: "enum";
        variants: [
          {
            name: "cat";
            fields: [
              {
                defined: {
                  name: "catId";
                };
              },
            ];
          },
          {
            name: "upgrade";
            fields: [
              {
                defined: {
                  name: "rarity";
                };
              },
            ];
          },
        ];
      };
    },
    {
      name: "drawStatus";
      type: {
        kind: "enum";
        variants: [
          {
            name: "pending";
          },
          {
            name: "fulfilled";
          },
          {
            name: "refunded";
          },
        ];
      };
    },
    {
      name: "entityKind";
      type: {
        kind: "enum";
        variants: [
          {
            name: "terrain";
          },
          {
            name: "hazard";
          },
          {
            name: "coin";
          },
          {
            name: "star";
          },
          {
            name: "booster";
            fields: [
              {
                defined: {
                  name: "power";
                };
              },
            ];
          },
          {
            name: "ramp";
            fields: ["i32"];
          },
        ];
      };
    },
    {
      name: "escrowStatus";
      type: {
        kind: "enum";
        variants: [
          {
            name: "reserved";
          },
          {
            name: "settledWin";
          },
          {
            name: "settledLoss";
          },
          {
            name: "refundedTechnical";
          },
        ];
      };
    },
    {
      name: "faultReason";
      type: {
        kind: "enum";
        variants: [
          {
            name: "oracleInvalid";
          },
          {
            name: "oracleStale";
          },
          {
            name: "unsafeWorld";
          },
          {
            name: "schedulerGap";
          },
          {
            name: "activationExpired";
          },
        ];
      };
    },
    {
      name: "gameConfig";
      type: {
        kind: "struct";
        fields: [
          {
            name: "schemaVersion";
            type: "u16";
          },
          {
            name: "bump";
            type: "u8";
          },
          {
            name: "admin";
            type: "pubkey";
          },
          {
            name: "usdcMint";
            type: "pubkey";
          },
          {
            name: "tokenProgram";
            type: "pubkey";
          },
          {
            name: "usdcDecimals";
            type: "u8";
          },
          {
            name: "rules";
            type: {
              option: {
                defined: {
                  name: "versionBinding";
                };
              };
            };
          },
          {
            name: "catalog";
            type: {
              option: {
                defined: {
                  name: "versionBinding";
                };
              };
            };
          },
          {
            name: "oracleBindings";
            type: {
              array: [
                {
                  defined: {
                    name: "oracleBinding";
                  };
                },
                3,
              ];
            };
          },
          {
            name: "vrfProgram";
            type: "pubkey";
          },
          {
            name: "vrfQueue";
            type: "pubkey";
          },
          {
            name: "vrfCallbackAuthority";
            type: "pubkey";
          },
          {
            name: "allowStarter";
            type: "bool";
          },
          {
            name: "allowPurchases";
            type: "bool";
          },
          {
            name: "allowReservations";
            type: "bool";
          },
        ];
      };
    },
    {
      name: "gameRules";
      type: {
        kind: "struct";
        fields: [
          {
            name: "schemaVersion";
            type: "u16";
          },
          {
            name: "rulesVersion";
            type: "u32";
          },
          {
            name: "ticksPerSecond";
            type: "u16";
          },
          {
            name: "checkpointTicks";
            type: "u16";
          },
          {
            name: "designatedCoins";
            type: "u8";
          },
          {
            name: "qualificationCoins";
            type: "u8";
          },
          {
            name: "initialMultiplierBps";
            type: {
              array: ["u32", 6];
            };
          },
          {
            name: "multiplierStepBps";
            type: "u32";
          },
          {
            name: "maxMultiplierBps";
            type: "u32";
          },
          {
            name: "speedStepBps";
            type: "u16";
          },
          {
            name: "maxSpeedBps";
            type: "u16";
          },
          {
            name: "powerDurationTicks";
            type: "u16";
          },
          {
            name: "shieldContactTicks";
            type: "u16";
          },
          {
            name: "heartbeatGraceTicks";
            type: "u16";
          },
          {
            name: "activationTimeoutSeconds";
            type: "u16";
          },
          {
            name: "suspensionTimeoutSeconds";
            type: "u16";
          },
          {
            name: "paidDrawTimeoutSeconds";
            type: "u16";
          },
          {
            name: "crankIntervalMs";
            type: "u16";
          },
          {
            name: "maxTicksPerCrank";
            type: "u8";
          },
          {
            name: "maxQueuedIntents";
            type: "u8";
          },
          {
            name: "maxControlUpdatesPerSecond";
            type: "u8";
          },
          {
            name: "maxPredictionTicks";
            type: "u8";
          },
          {
            name: "maxLocalIntents";
            type: "u16";
          },
          {
            name: "maxWorldEntities";
            type: "u8";
          },
          {
            name: "maxRecentObservations";
            type: "u8";
          },
          {
            name: "physics";
            type: {
              defined: {
                name: "physicsRules";
              };
            };
          },
          {
            name: "generation";
            type: {
              defined: {
                name: "generationRules";
              };
            };
          },
          {
            name: "score";
            type: {
              defined: {
                name: "scoreRules";
              };
            };
          },
        ];
      };
    },
    {
      name: "gameRulesVersion";
      type: {
        kind: "struct";
        fields: [
          {
            name: "schemaVersion";
            type: "u16";
          },
          {
            name: "bump";
            type: "u8";
          },
          {
            name: "binding";
            type: {
              defined: {
                name: "versionBinding";
              };
            };
          },
          {
            name: "rules";
            type: {
              defined: {
                name: "gameRules";
              };
            };
          },
        ];
      };
    },
    {
      name: "generationRules";
      type: {
        kind: "struct";
        fields: [
          {
            name: "segmentWidthSubpixels";
            type: "i32";
          },
          {
            name: "lookaheadSegments";
            type: "u8";
          },
          {
            name: "flatBandBps";
            type: "u16";
          },
          {
            name: "sharpMoveBps";
            type: "u16";
          },
          {
            name: "maxSampleChangeBps";
            type: "u16";
          },
          {
            name: "designatedCoinTicks";
            type: {
              array: ["u16", 5];
            };
          },
          {
            name: "maxHazardsPerSegment";
            type: "u8";
          },
          {
            name: "maxOptionalPickupsPerSegment";
            type: "u8";
          },
          {
            name: "boosterStrideSegments";
            type: "u16";
          },
        ];
      };
    },
    {
      name: "generationState";
      type: {
        kind: "struct";
        fields: [
          {
            name: "nextSegment";
            type: "u64";
          },
          {
            name: "nextXSubpixels";
            type: "i32";
          },
          {
            name: "surfaceYSubpixels";
            type: "i32";
          },
          {
            name: "checkpoint";
            type: "u64";
          },
          {
            name: "checkpointXSubpixels";
            type: "i32";
          },
          {
            name: "checkpointSpeedSubpixelsPerTick";
            type: "i32";
          },
          {
            name: "spawnedCoinMask";
            type: "u8";
          },
          {
            name: "spawnedHazardMask";
            type: "u8";
          },
        ];
      };
    },
    {
      name: "hostedOracleQuote";
      type: {
        kind: "struct";
        fields: [
          {
            name: "writeAuthority";
            type: "pubkey";
          },
          {
            name: "verificationLevel";
            type: "u8";
          },
          {
            name: "feedId";
            type: {
              array: ["u8", 32];
            };
          },
          {
            name: "price";
            type: "i64";
          },
          {
            name: "confidence";
            type: "u64";
          },
          {
            name: "exponent";
            type: "i32";
          },
          {
            name: "publishedAtSeconds";
            type: "i64";
          },
          {
            name: "previousPublishedAtSeconds";
            type: "i64";
          },
          {
            name: "emaPrice";
            type: "i64";
          },
          {
            name: "emaConfidence";
            type: "u64";
          },
          {
            name: "postedSlot";
            type: "u64";
          },
        ];
      };
    },
    {
      name: "houseState";
      type: {
        kind: "struct";
        fields: [
          {
            name: "schemaVersion";
            type: "u16";
          },
          {
            name: "bump";
            type: "u8";
          },
          {
            name: "config";
            type: "pubkey";
          },
          {
            name: "usdcMint";
            type: "pubkey";
          },
          {
            name: "vault";
            type: "pubkey";
          },
          {
            name: "totalAvailableBaseUnits";
            type: "u64";
          },
          {
            name: "totalPurchaseEscrowBaseUnits";
            type: "u64";
          },
          {
            name: "totalMaxGrossBaseUnits";
            type: "u64";
          },
          {
            name: "bufferBaseUnits";
            type: "u64";
          },
        ];
      };
    },
    {
      name: "initializeConfigArgs";
      type: {
        kind: "struct";
        fields: [
          {
            name: "oracleBindings";
            type: {
              array: [
                {
                  defined: {
                    name: "oracleBinding";
                  };
                },
                3,
              ];
            };
          },
        ];
      };
    },
    {
      name: "inputAxis";
      type: {
        kind: "enum";
        variants: [
          {
            name: "left";
          },
          {
            name: "neutral";
          },
          {
            name: "right";
          },
        ];
      };
    },
    {
      name: "inputPermission";
      type: {
        kind: "struct";
        fields: [
          {
            name: "owner";
            type: "pubkey";
          },
          {
            name: "inputKey";
            type: "pubkey";
          },
          {
            name: "program";
            type: "pubkey";
          },
          {
            name: "sessionToken";
            type: "pubkey";
          },
          {
            name: "expiresAtSeconds";
            type: "i64";
          },
        ];
      };
    },
    {
      name: "inspectedOracle";
      type: {
        kind: "struct";
        fields: [
          {
            name: "market";
            type: {
              defined: {
                name: "market";
              };
            };
          },
          {
            name: "quote";
            type: {
              defined: {
                name: "hostedOracleQuote";
              };
            };
          },
          {
            name: "contentHash";
            type: {
              array: ["u8", 32];
            };
          },
        ];
      };
    },
    {
      name: "intentEnvelope";
      type: {
        kind: "struct";
        fields: [
          {
            name: "protocolVersion";
            type: "u16";
          },
          {
            name: "rulesVersion";
            type: "u32";
          },
          {
            name: "run";
            type: "pubkey";
          },
          {
            name: "clientSequence";
            type: "u64";
          },
          {
            name: "action";
            type: {
              defined: {
                name: "playerIntent";
              };
            };
          },
        ];
      };
    },
    {
      name: "market";
      type: {
        kind: "enum";
        variants: [
          {
            name: "btc";
          },
          {
            name: "eth";
          },
          {
            name: "sol";
          },
        ];
      };
    },
    {
      name: "oracleBinding";
      type: {
        kind: "struct";
        fields: [
          {
            name: "program";
            type: "pubkey";
          },
          {
            name: "account";
            type: "pubkey";
          },
          {
            name: "writeAuthority";
            type: "pubkey";
          },
          {
            name: "validator";
            type: "pubkey";
          },
          {
            name: "feedId";
            type: "u32";
          },
          {
            name: "schemaVersion";
            type: "u16";
          },
          {
            name: "maxAgeSeconds";
            type: "u16";
          },
          {
            name: "maxFutureSkewSeconds";
            type: "u16";
          },
          {
            name: "minExponent";
            type: "i32";
          },
          {
            name: "maxExponent";
            type: "i32";
          },
        ];
      };
    },
    {
      name: "oracleObservation";
      type: {
        kind: "struct";
        fields: [
          {
            name: "sequence";
            type: "u64";
          },
          {
            name: "price";
            type: "i64";
          },
          {
            name: "exponent";
            type: "i32";
          },
          {
            name: "publishedAtSeconds";
            type: "i64";
          },
          {
            name: "postedSlot";
            type: "u64";
          },
          {
            name: "contentHash";
            type: {
              array: ["u8", 32];
            };
          },
        ];
      };
    },
    {
      name: "ownedCat";
      type: {
        kind: "struct";
        fields: [
          {
            name: "cat";
            type: {
              defined: {
                name: "catId";
              };
            };
          },
          {
            name: "rarity";
            type: {
              defined: {
                name: "rarity";
              };
            };
          },
          {
            name: "definingCatalog";
            type: {
              defined: {
                name: "versionBinding";
              };
            };
          },
          {
            name: "level";
            type: "u8";
          },
        ];
      };
    },
    {
      name: "physicsRules";
      docs: [
        "Positions are segment-local signed subpixels (256/pixel), y increases down.",
        "Velocities are subpixels/tick; gravity is subpixels/tick². Widen products to",
        "i64 and divide toward zero; money uses u128 and rounds down. Never use floats.",
        "Rebase the world origin before a coordinate leaves the published bound;",
        "distance/score/ticks/sequences use checked u64, never wrapping counters.",
        "Each tick: ordered commands -> gravity/velocity -> swept terrain X then Y ->",
        "hazards by entity ID -> pickups by entity ID -> checkpoint if still alive.",
        "Touching edges count as terrain contact, but not hazard/pickup overlap.",
        "MOVE is a -1/0/+1 airborne horizontal offset, not an acceleration. Grounded",
        "Jump sets vy to jump_velocity; gravity applies before position integration.",
        "Ease automatic speed toward the level target while grounded, retain it in",
        "air, then add air control and any dash bonus; clamp velocity before sweeping.",
        "Geometry caps are necessary, not a reachability proof: generated required",
        "routes must still pass the base-control solver for every cat at level 1.",
        "The first terminal stops the tick. Effect end ticks are exclusive; a power",
        "armed at tick t is live through t+179. Suspension advances no active timers.",
      ];
      type: {
        kind: "struct";
        fields: [
          {
            name: "subpixelsPerPixel";
            type: "u16";
          },
          {
            name: "viewportWidthPixels";
            type: "u16";
          },
          {
            name: "viewportHeightPixels";
            type: "u16";
          },
          {
            name: "coordinateLimitSubpixels";
            type: "i32";
          },
          {
            name: "maxVelocitySubpixelsPerTick";
            type: "i32";
          },
          {
            name: "runnerSpeedSubpixelsPerTick";
            type: "i32";
          },
          {
            name: "speedEasingSubpixelsPerTick";
            type: "i32";
          },
          {
            name: "jumpVelocitySubpixelsPerTick";
            type: "i32";
          },
          {
            name: "gravitySubpixelsPerTickSquared";
            type: "i32";
          },
          {
            name: "airControlSubpixelsPerTick";
            type: "i32";
          },
          {
            name: "dashBonusSubpixelsPerTick";
            type: "i32";
          },
          {
            name: "dashDurationTicks";
            type: "u16";
          },
          {
            name: "dashCooldownTicks";
            type: "u16";
          },
          {
            name: "pickupRadiusSubpixels";
            type: "i32";
          },
          {
            name: "hitboxWidthSubpixels";
            type: "i32";
          },
          {
            name: "hitboxHeightSubpixels";
            type: "i32";
          },
          {
            name: "maxRequiredGapSubpixels";
            type: "i32";
          },
          {
            name: "maxRequiredRiseSubpixels";
            type: "i32";
          },
          {
            name: "minLandingWidthSubpixels";
            type: "i32";
          },
          {
            name: "minRequiredCoinSpacingTicks";
            type: "u16";
          },
        ];
      };
    },
    {
      name: "playerAccount";
      type: {
        kind: "struct";
        fields: [
          {
            name: "schemaVersion";
            type: "u16";
          },
          {
            name: "bump";
            type: "u8";
          },
          {
            name: "owner";
            type: "pubkey";
          },
          {
            name: "availableBaseUnits";
            type: "u64";
          },
          {
            name: "lockedStakeBaseUnits";
            type: "u64";
          },
          {
            name: "purchaseEscrowBaseUnits";
            type: "u64";
          },
          {
            name: "nextRunNonce";
            type: "u64";
          },
          {
            name: "nextDrawNonce";
            type: "u64";
          },
          {
            name: "nextSessionNonce";
            type: "u64";
          },
          {
            name: "settledRuns";
            type: "u64";
          },
          {
            name: "wins";
            type: "u64";
          },
          {
            name: "losses";
            type: "u64";
          },
          {
            name: "technicalRefunds";
            type: "u64";
          },
        ];
      };
    },
    {
      name: "playerIntent";
      type: {
        kind: "enum";
        variants: [
          {
            name: "move";
            fields: [
              {
                name: "axis";
                type: {
                  defined: {
                    name: "inputAxis";
                  };
                };
              },
            ];
          },
          {
            name: "jump";
          },
          {
            name: "dash";
          },
          {
            name: "boost";
          },
          {
            name: "cashOut";
          },
          {
            name: "surrender";
          },
          {
            name: "heartbeat";
            fields: [
              {
                name: "active";
                type: "bool";
              },
            ];
          },
          {
            name: "inactive";
          },
        ];
      };
    },
    {
      name: "power";
      type: {
        kind: "enum";
        variants: [
          {
            name: "magnet";
          },
          {
            name: "doubleJump";
          },
          {
            name: "shield";
          },
          {
            name: "extraDash";
          },
        ];
      };
    },
    {
      name: "powerState";
      type: {
        kind: "struct";
        fields: [
          {
            name: "readyAtTick";
            type: "u64";
          },
          {
            name: "endsAtTick";
            type: "u64";
          },
          {
            name: "charges";
            type: "u8";
          },
        ];
      };
    },
    {
      name: "publishCatalogArgs";
      type: {
        kind: "struct";
        fields: [
          {
            name: "expectedCurrentVersion";
            type: "u32";
          },
          {
            name: "catalog";
            type: {
              defined: {
                name: "catalog";
              };
            };
          },
          {
            name: "assetManifest";
            type: {
              defined: {
                name: "versionBinding";
              };
            };
          },
        ];
      };
    },
    {
      name: "publishRulesArgs";
      type: {
        kind: "struct";
        fields: [
          {
            name: "expectedCurrentVersion";
            type: "u32";
          },
          {
            name: "rules";
            type: {
              defined: {
                name: "gameRules";
              };
            };
          },
        ];
      };
    },
    {
      name: "rarity";
      type: {
        kind: "enum";
        variants: [
          {
            name: "common";
          },
          {
            name: "rare";
          },
          {
            name: "epic";
          },
        ];
      };
    },
    {
      name: "requestCapsuleArgs";
      type: {
        kind: "struct";
        fields: [
          {
            name: "expectedDrawNonce";
            type: "u64";
          },
          {
            name: "expectedInventoryVersion";
            type: "u64";
          },
          {
            name: "expectedCatalogVersion";
            type: "u32";
          },
          {
            name: "kind";
            type: {
              defined: {
                name: "capsuleKind";
              };
            };
          },
          {
            name: "maxPayerDebitLamports";
            type: "u64";
          },
        ];
      };
    },
    {
      name: "runEscrow";
      type: {
        kind: "struct";
        fields: [
          {
            name: "schemaVersion";
            type: "u16";
          },
          {
            name: "bump";
            type: "u8";
          },
          {
            name: "gameState";
            type: "pubkey";
          },
          {
            name: "snapshot";
            type: {
              defined: {
                name: "runSnapshot";
              };
            };
          },
          {
            name: "snapshotHash";
            type: {
              array: ["u8", 32];
            };
          },
          {
            name: "sponsorBudget";
            type: "pubkey";
          },
          {
            name: "delegationInitiated";
            type: "bool";
          },
          {
            name: "status";
            type: {
              defined: {
                name: "escrowStatus";
              };
            };
          },
          {
            name: "receipt";
            type: {
              option: "pubkey";
            };
          },
        ];
      };
    },
    {
      name: "runGameState";
      type: {
        kind: "struct";
        fields: [
          {
            name: "schemaVersion";
            type: "u16";
          },
          {
            name: "bump";
            type: "u8";
          },
          {
            name: "escrow";
            type: "pubkey";
          },
          {
            name: "snapshot";
            type: {
              defined: {
                name: "runSnapshot";
              };
            };
          },
          {
            name: "snapshotHash";
            type: {
              array: ["u8", 32];
            };
          },
          {
            name: "phase";
            type: {
              defined: {
                name: "runPhase";
              };
            };
          },
          {
            name: "activeTicks";
            type: "u64";
          },
          {
            name: "worldOriginPixels";
            type: "u64";
          },
          {
            name: "runner";
            type: {
              defined: {
                name: "runnerState";
              };
            };
          },
          {
            name: "entities";
            type: {
              vec: {
                defined: {
                  name: "worldEntity";
                };
              };
            };
          },
          {
            name: "entityCount";
            type: "u8";
          },
          {
            name: "nextEntityId";
            type: "u64";
          },
          {
            name: "observations";
            type: {
              vec: {
                defined: {
                  name: "oracleObservation";
                };
              };
            };
          },
          {
            name: "observationHead";
            type: "u8";
          },
          {
            name: "observationCount";
            type: "u8";
          },
          {
            name: "startObservation";
            type: {
              option: {
                defined: {
                  name: "oracleObservation";
                };
              };
            };
          },
          {
            name: "intents";
            type: {
              vec: {
                option: {
                  defined: {
                    name: "acceptedIntent";
                  };
                };
              };
            };
          },
          {
            name: "intentHead";
            type: "u8";
          },
          {
            name: "intentCount";
            type: "u8";
          },
          {
            name: "lastAcceptedSequence";
            type: "u64";
          },
          {
            name: "lastProcessedSequence";
            type: "u64";
          },
          {
            name: "lastAcceptedOrder";
            type: "u64";
          },
          {
            name: "controlWindowSeconds";
            type: "i64";
          },
          {
            name: "controlUpdatesInWindow";
            type: "u8";
          },
          {
            name: "lastHeartbeatTick";
            type: "u64";
          },
          {
            name: "inactiveExitTick";
            type: {
              option: "u64";
            };
          },
          {
            name: "keyExitTick";
            type: {
              option: "u64";
            };
          },
          {
            name: "inputKeyRevoked";
            type: "bool";
          },
          {
            name: "score";
            type: "u64";
          },
          {
            name: "totalCoins";
            type: "u64";
          },
          {
            name: "designatedCoinMask";
            type: "u8";
          },
          {
            name: "qualifiedCheckpoints";
            type: "u64";
          },
          {
            name: "powers";
            type: {
              array: [
                {
                  defined: {
                    name: "powerState";
                  };
                },
                4,
              ];
            };
          },
          {
            name: "crank";
            type: {
              defined: {
                name: "crankState";
              };
            };
          },
          {
            name: "worldGeneration";
            type: {
              defined: {
                name: "generationState";
              };
            };
          },
          {
            name: "suspension";
            type: {
              option: {
                defined: {
                  name: "suspension";
                };
              };
            };
          },
          {
            name: "terminal";
            type: {
              option: {
                defined: {
                  name: "runTerminal";
                };
              };
            };
          },
        ];
      };
    },
    {
      name: "runPhase";
      type: {
        kind: "enum";
        variants: [
          {
            name: "ready";
          },
          {
            name: "active";
          },
          {
            name: "suspended";
          },
          {
            name: "terminalRecorded";
          },
          {
            name: "completionRequested";
          },
        ];
      };
    },
    {
      name: "runSnapshot";
      type: {
        kind: "struct";
        fields: [
          {
            name: "protocolVersion";
            type: "u16";
          },
          {
            name: "run";
            type: "pubkey";
          },
          {
            name: "owner";
            type: "pubkey";
          },
          {
            name: "nonce";
            type: "u64";
          },
          {
            name: "market";
            type: {
              defined: {
                name: "market";
              };
            };
          },
          {
            name: "stakeBaseUnits";
            type: "u64";
          },
          {
            name: "maxGrossBaseUnits";
            type: "u64";
          },
          {
            name: "rulesBinding";
            type: {
              defined: {
                name: "versionBinding";
              };
            };
          },
          {
            name: "rules";
            type: {
              defined: {
                name: "gameRules";
              };
            };
          },
          {
            name: "cat";
            type: {
              defined: {
                name: "catSnapshot";
              };
            };
          },
          {
            name: "oracle";
            type: {
              defined: {
                name: "oracleBinding";
              };
            };
          },
          {
            name: "inputPermission";
            type: {
              defined: {
                name: "inputPermission";
              };
            };
          },
          {
            name: "assetManifest";
            type: {
              defined: {
                name: "versionBinding";
              };
            };
          },
          {
            name: "activationDeadlineSeconds";
            type: "i64";
          },
          {
            name: "delegationEpoch";
            type: "u64";
          },
        ];
      };
    },
    {
      name: "runStatusView";
      type: {
        kind: "struct";
        fields: [
          {
            name: "phase";
            type: {
              defined: {
                name: "runPhase";
              };
            };
          },
          {
            name: "activeTicks";
            type: "u64";
          },
          {
            name: "acceptedSequence";
            type: "u64";
          },
          {
            name: "processedSequence";
            type: "u64";
          },
        ];
      };
    },
    {
      name: "runTerminal";
      type: {
        kind: "struct";
        fields: [
          {
            name: "reason";
            type: {
              defined: {
                name: "terminalReason";
              };
            };
          },
          {
            name: "fault";
            type: {
              option: {
                defined: {
                  name: "faultReason";
                };
              };
            };
          },
          {
            name: "activeTicks";
            type: "u64";
          },
          {
            name: "qualifiedCheckpoints";
            type: "u64";
          },
          {
            name: "score";
            type: "u64";
          },
          {
            name: "coins";
            type: "u64";
          },
          {
            name: "processedSequence";
            type: "u64";
          },
          {
            name: "finalObservation";
            type: {
              option: {
                defined: {
                  name: "oracleObservation";
                };
              };
            };
          },
          {
            name: "grossPayoutBaseUnits";
            type: "u64";
          },
          {
            name: "refundBaseUnits";
            type: "u64";
          },
        ];
      };
    },
    {
      name: "runnerState";
      type: {
        kind: "struct";
        fields: [
          {
            name: "xSubpixels";
            type: "i32";
          },
          {
            name: "ySubpixels";
            type: "i32";
          },
          {
            name: "vxSubpixelsPerTick";
            type: "i32";
          },
          {
            name: "vySubpixelsPerTick";
            type: "i32";
          },
          {
            name: "automaticSpeedSubpixelsPerTick";
            type: "i32";
          },
          {
            name: "grounded";
            type: "bool";
          },
          {
            name: "axis";
            type: {
              defined: {
                name: "inputAxis";
              };
            };
          },
          {
            name: "dashEndsAtTick";
            type: "u64";
          },
          {
            name: "dashReadyAtTick";
            type: "u64";
          },
          {
            name: "shieldContactEndsAtTick";
            type: "u64";
          },
        ];
      };
    },
    {
      name: "scoreRules";
      type: {
        kind: "struct";
        fields: [
          {
            name: "coinPoints";
            type: "u16";
          },
          {
            name: "starPoints";
            type: "u16";
          },
        ];
      };
    },
    {
      name: "selectCatArgs";
      type: {
        kind: "struct";
        fields: [
          {
            name: "expectedInventoryVersion";
            type: "u64";
          },
          {
            name: "cat";
            type: {
              defined: {
                name: "catId";
              };
            };
          },
        ];
      };
    },
    {
      name: "setAdmissionArgs";
      type: {
        kind: "struct";
        fields: [
          {
            name: "starter";
            type: "bool";
          },
          {
            name: "purchases";
            type: "bool";
          },
          {
            name: "reservations";
            type: "bool";
          },
        ];
      };
    },
    {
      name: "starterClaim";
      type: {
        kind: "enum";
        variants: [
          {
            name: "unclaimed";
          },
          {
            name: "pending";
          },
          {
            name: "fulfilled";
          },
        ];
      };
    },
    {
      name: "suspension";
      type: {
        kind: "struct";
        fields: [
          {
            name: "reason";
            type: {
              defined: {
                name: "faultReason";
              };
            };
          },
          {
            name: "startedAtSeconds";
            type: "i64";
          },
        ];
      };
    },
    {
      name: "terminalReason";
      type: {
        kind: "enum";
        variants: [
          {
            name: "cashOut";
          },
          {
            name: "crash";
          },
          {
            name: "autoCashOut";
          },
          {
            name: "surrender";
          },
          {
            name: "technicalAbort";
          },
        ];
      };
    },
    {
      name: "upgradeDefinition";
      type: {
        kind: "struct";
        fields: [
          {
            name: "rarity";
            type: {
              defined: {
                name: "rarity";
              };
            };
          },
          {
            name: "weight";
            type: "u16";
          },
          {
            name: "levelGain";
            type: "u8";
          },
        ];
      };
    },
    {
      name: "versionBinding";
      type: {
        kind: "struct";
        fields: [
          {
            name: "version";
            type: "u32";
          },
          {
            name: "contentHash";
            type: {
              array: ["u8", 32];
            };
          },
        ];
      };
    },
    {
      name: "worldEntity";
      type: {
        kind: "struct";
        fields: [
          {
            name: "id";
            type: "u64";
          },
          {
            name: "kind";
            type: {
              defined: {
                name: "entityKind";
              };
            };
          },
          {
            name: "xSubpixels";
            type: "i32";
          },
          {
            name: "ySubpixels";
            type: "i32";
          },
          {
            name: "widthSubpixels";
            type: "i32";
          },
          {
            name: "heightSubpixels";
            type: "i32";
          },
          {
            name: "designatedCoin";
            type: {
              option: "u8";
            };
          },
          {
            name: "designatedCheckpoint";
            type: "u64";
          },
          {
            name: "consumed";
            type: "bool";
          },
        ];
      };
    },
  ];
  constants: [
    {
      name: "counterSeed";
      type: "bytes";
      value: "[99, 111, 117, 110, 116, 101, 114]";
    },
    {
      name: "helloWorldLamports";
      type: "u64";
      value: "1";
    },
    {
      name: "maxCount";
      type: "u64";
      value: "10";
    },
  ];
};

export const PURRPS_GAME_IDL = {
  address: "F1cmavHq4562uJ8JmRPM5oFk8q28GW5hadXnZfVCCcUx",
  metadata: {
    name: "purrps_game",
    version: "0.1.0",
    spec: "0.1.0",
    description: "PURRPS vault, wager and settlement program",
  },
  instructions: [
    {
      name: "claim_starter",
      discriminator: [142, 187, 84, 81, 84, 148, 223, 217],
      accounts: [
        {
          name: "config",
          pda: {
            seeds: [
              {
                kind: "const",
                value: [103, 97, 109, 101, 45, 99, 111, 110, 102, 105, 103],
              },
            ],
          },
        },
        {
          name: "owner",
          signer: true,
          relations: ["player", "collection"],
        },
        {
          name: "payer",
          writable: true,
          signer: true,
        },
        {
          name: "player",
          writable: true,
          pda: {
            seeds: [
              {
                kind: "const",
                value: [112, 108, 97, 121, 101, 114],
              },
              {
                kind: "account",
                path: "owner",
              },
            ],
          },
        },
        {
          name: "collection",
          writable: true,
          pda: {
            seeds: [
              {
                kind: "const",
                value: [99, 111, 108, 108, 101, 99, 116, 105, 111, 110],
              },
              {
                kind: "account",
                path: "owner",
              },
            ],
          },
        },
        {
          name: "catalog",
          pda: {
            seeds: [
              {
                kind: "const",
                value: [99, 97, 116, 97, 108, 111, 103],
              },
              {
                kind: "arg",
                path: "args.expected_catalog_version",
              },
            ],
          },
        },
        {
          name: "draw",
          writable: true,
          pda: {
            seeds: [
              {
                kind: "const",
                value: [100, 114, 97, 119],
              },
              {
                kind: "account",
                path: "owner",
              },
              {
                kind: "arg",
                path: "args.expected_draw_nonce",
              },
            ],
          },
        },
        {
          name: "oracle_queue",
          writable: true,
        },
        {
          name: "program_identity",
          pda: {
            seeds: [
              {
                kind: "const",
                value: [105, 100, 101, 110, 116, 105, 116, 121],
              },
            ],
          },
        },
        {
          name: "vrf_program",
          address: "Vrf1RNUjXmQGjmQrQLvJHs9SNkvDJEsRVFPkfSQUwGz",
        },
        {
          name: "slot_hashes",
          address: "SysvarS1otHashes111111111111111111111111111",
        },
        {
          name: "system_program",
          address: "11111111111111111111111111111111",
        },
      ],
      args: [
        {
          name: "args",
          type: {
            defined: {
              name: "RequestCapsuleArgs",
            },
          },
        },
      ],
    },
    {
      name: "create_player",
      discriminator: [19, 178, 189, 216, 159, 134, 0, 192],
      accounts: [
        {
          name: "config",
          pda: {
            seeds: [
              {
                kind: "const",
                value: [103, 97, 109, 101, 45, 99, 111, 110, 102, 105, 103],
              },
            ],
          },
        },
        {
          name: "owner",
          signer: true,
        },
        {
          name: "payer",
          writable: true,
          signer: true,
        },
        {
          name: "player",
          writable: true,
          pda: {
            seeds: [
              {
                kind: "const",
                value: [112, 108, 97, 121, 101, 114],
              },
              {
                kind: "account",
                path: "owner",
              },
            ],
          },
        },
        {
          name: "collection",
          writable: true,
          pda: {
            seeds: [
              {
                kind: "const",
                value: [99, 111, 108, 108, 101, 99, 116, 105, 111, 110],
              },
              {
                kind: "account",
                path: "owner",
              },
            ],
          },
        },
        {
          name: "system_program",
          address: "11111111111111111111111111111111",
        },
      ],
      args: [],
    },
    {
      name: "deposit",
      discriminator: [242, 35, 198, 137, 82, 225, 242, 182],
      accounts: [
        {
          name: "config",
          pda: {
            seeds: [
              {
                kind: "const",
                value: [103, 97, 109, 101, 45, 99, 111, 110, 102, 105, 103],
              },
            ],
          },
          relations: ["house"],
        },
        {
          name: "owner",
          signer: true,
          relations: ["player"],
        },
        {
          name: "player",
          writable: true,
          pda: {
            seeds: [
              {
                kind: "const",
                value: [112, 108, 97, 121, 101, 114],
              },
              {
                kind: "account",
                path: "owner",
              },
            ],
          },
        },
        {
          name: "house",
          writable: true,
          pda: {
            seeds: [
              {
                kind: "const",
                value: [104, 111, 117, 115, 101],
              },
            ],
          },
        },
        {
          name: "vault",
          writable: true,
        },
        {
          name: "owner_tokens",
          writable: true,
        },
        {
          name: "usdc_mint",
          address: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
        },
        {
          name: "token_program",
          address: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
        },
      ],
      args: [
        {
          name: "args",
          type: {
            defined: {
              name: "AmountArgs",
            },
          },
        },
      ],
    },
    {
      name: "fulfill_starter",
      discriminator: [114, 170, 35, 28, 32, 184, 26, 211],
      accounts: [
        {
          name: "vrf_program_identity",
          docs: [
            "Scoped VRF identity PDA, bound to this program. Its presence as a signer proves",
            "the callback was issued by the VRF program for this program.",
          ],
          signer: true,
        },
        {
          name: "config",
          pda: {
            seeds: [
              {
                kind: "const",
                value: [103, 97, 109, 101, 45, 99, 111, 110, 102, 105, 103],
              },
            ],
          },
        },
        {
          name: "draw",
          writable: true,
          pda: {
            seeds: [
              {
                kind: "const",
                value: [100, 114, 97, 119],
              },
              {
                kind: "account",
                path: "draw.owner",
                account: "CapsuleDraw",
              },
              {
                kind: "account",
                path: "draw.nonce",
                account: "CapsuleDraw",
              },
            ],
          },
        },
        {
          name: "collection",
          writable: true,
          pda: {
            seeds: [
              {
                kind: "const",
                value: [99, 111, 108, 108, 101, 99, 116, 105, 111, 110],
              },
              {
                kind: "account",
                path: "draw.owner",
                account: "CapsuleDraw",
              },
            ],
          },
        },
        {
          name: "catalog",
          pda: {
            seeds: [
              {
                kind: "const",
                value: [99, 97, 116, 97, 108, 111, 103],
              },
              {
                kind: "account",
                path: "draw.catalog.version",
                account: "CapsuleDraw",
              },
            ],
          },
        },
      ],
      args: [
        {
          name: "randomness",
          type: {
            array: ["u8", 32],
          },
        },
        {
          name: "seed",
          type: {
            array: ["u8", 32],
          },
        },
      ],
    },
    {
      name: "fund_house",
      discriminator: [175, 231, 49, 44, 144, 102, 41, 69],
      accounts: [
        {
          name: "config",
          pda: {
            seeds: [
              {
                kind: "const",
                value: [103, 97, 109, 101, 45, 99, 111, 110, 102, 105, 103],
              },
            ],
          },
          relations: ["house"],
        },
        {
          name: "admin",
          signer: true,
          relations: ["config"],
        },
        {
          name: "house",
          writable: true,
          pda: {
            seeds: [
              {
                kind: "const",
                value: [104, 111, 117, 115, 101],
              },
            ],
          },
        },
        {
          name: "vault",
          writable: true,
        },
        {
          name: "admin_tokens",
          writable: true,
        },
        {
          name: "usdc_mint",
          address: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
        },
        {
          name: "token_program",
          address: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
        },
      ],
      args: [
        {
          name: "args",
          type: {
            defined: {
              name: "AmountArgs",
            },
          },
        },
      ],
    },
    {
      name: "increment",
      discriminator: [11, 18, 104, 9, 104, 174, 59, 33],
      accounts: [
        {
          name: "counter",
          writable: true,
          pda: {
            seeds: [
              {
                kind: "const",
                value: [99, 111, 117, 110, 116, 101, 114],
              },
            ],
          },
        },
        {
          name: "authority",
          signer: true,
        },
      ],
      args: [],
    },
    {
      name: "initialize",
      discriminator: [175, 175, 109, 31, 13, 152, 155, 237],
      accounts: [
        {
          name: "payer",
          writable: true,
          signer: true,
        },
        {
          name: "counter",
          writable: true,
          pda: {
            seeds: [
              {
                kind: "const",
                value: [99, 111, 117, 110, 116, 101, 114],
              },
            ],
          },
        },
        {
          name: "system_program",
          address: "11111111111111111111111111111111",
        },
      ],
      args: [],
    },
    {
      name: "initialize_config",
      discriminator: [208, 127, 21, 1, 194, 190, 196, 70],
      accounts: [
        {
          name: "program",
          address: "F1cmavHq4562uJ8JmRPM5oFk8q28GW5hadXnZfVCCcUx",
        },
        {
          name: "program_data",
        },
        {
          name: "admin",
          writable: true,
          signer: true,
        },
        {
          name: "config",
          writable: true,
          pda: {
            seeds: [
              {
                kind: "const",
                value: [103, 97, 109, 101, 45, 99, 111, 110, 102, 105, 103],
              },
            ],
          },
        },
        {
          name: "usdc_mint",
          address: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
        },
        {
          name: "token_program",
          address: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
        },
        {
          name: "system_program",
          address: "11111111111111111111111111111111",
        },
      ],
      args: [
        {
          name: "args",
          type: {
            defined: {
              name: "InitializeConfigArgs",
            },
          },
        },
      ],
    },
    {
      name: "initialize_house",
      discriminator: [180, 46, 86, 125, 135, 107, 214, 28],
      accounts: [
        {
          name: "config",
          pda: {
            seeds: [
              {
                kind: "const",
                value: [103, 97, 109, 101, 45, 99, 111, 110, 102, 105, 103],
              },
            ],
          },
        },
        {
          name: "admin",
          writable: true,
          signer: true,
          relations: ["config"],
        },
        {
          name: "house",
          writable: true,
          pda: {
            seeds: [
              {
                kind: "const",
                value: [104, 111, 117, 115, 101],
              },
            ],
          },
        },
        {
          name: "vault",
          writable: true,
          pda: {
            seeds: [
              {
                kind: "account",
                path: "house",
              },
              {
                kind: "account",
                path: "token_program",
              },
              {
                kind: "account",
                path: "usdc_mint",
              },
            ],
            program: {
              kind: "const",
              value: [
                140, 151, 37, 143, 78, 36, 137, 241, 187, 61, 16, 41, 20, 142,
                13, 131, 11, 90, 19, 153, 218, 255, 16, 132, 4, 142, 123, 216,
                219, 233, 248, 89,
              ],
            },
          },
        },
        {
          name: "usdc_mint",
          address: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
        },
        {
          name: "token_program",
          address: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
        },
        {
          name: "associated_token_program",
          address: "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
        },
        {
          name: "system_program",
          address: "11111111111111111111111111111111",
        },
      ],
      args: [],
    },
    {
      name: "inspect_oracle",
      discriminator: [13, 147, 53, 187, 95, 3, 159, 245],
      accounts: [
        {
          name: "config",
          pda: {
            seeds: [
              {
                kind: "const",
                value: [103, 97, 109, 101, 45, 99, 111, 110, 102, 105, 103],
              },
            ],
          },
        },
        {
          name: "price_update",
          docs: [
            "are validated by inspect_account; this instruction mutates no state.",
          ],
        },
      ],
      args: [
        {
          name: "market",
          type: {
            defined: {
              name: "Market",
            },
          },
        },
      ],
      returns: {
        defined: {
          name: "InspectedOracle",
        },
      },
    },
    {
      name: "inspect_run",
      discriminator: [42, 235, 206, 25, 145, 139, 255, 24],
      accounts: [
        {
          name: "run",
          pda: {
            seeds: [
              {
                kind: "const",
                value: [114, 117, 110, 45, 103, 97, 109, 101],
              },
              {
                kind: "account",
                path: "run.snapshot.owner",
                account: "RunGameState",
              },
              {
                kind: "account",
                path: "run.snapshot.nonce",
                account: "RunGameState",
              },
            ],
          },
        },
      ],
      args: [],
      returns: {
        defined: {
          name: "RunStatusView",
        },
      },
    },
    {
      name: "inspect_run_escrow",
      discriminator: [50, 0, 92, 55, 15, 250, 129, 225],
      accounts: [
        {
          name: "escrow",
          pda: {
            seeds: [
              {
                kind: "const",
                value: [114, 117, 110, 45, 101, 115, 99, 114, 111, 119],
              },
              {
                kind: "account",
                path: "escrow.snapshot.owner",
                account: "RunEscrow",
              },
              {
                kind: "account",
                path: "escrow.snapshot.nonce",
                account: "RunEscrow",
              },
            ],
          },
        },
      ],
      args: [],
    },
    {
      name: "publish_catalog",
      discriminator: [66, 196, 22, 78, 35, 243, 245, 190],
      accounts: [
        {
          name: "config",
          writable: true,
          pda: {
            seeds: [
              {
                kind: "const",
                value: [103, 97, 109, 101, 45, 99, 111, 110, 102, 105, 103],
              },
            ],
          },
        },
        {
          name: "admin",
          writable: true,
          signer: true,
          relations: ["config"],
        },
        {
          name: "catalog",
          writable: true,
          pda: {
            seeds: [
              {
                kind: "const",
                value: [99, 97, 116, 97, 108, 111, 103],
              },
              {
                kind: "arg",
                path: "args.catalog.catalog_version",
              },
            ],
          },
        },
        {
          name: "system_program",
          address: "11111111111111111111111111111111",
        },
      ],
      args: [
        {
          name: "args",
          type: {
            defined: {
              name: "PublishCatalogArgs",
            },
          },
        },
      ],
    },
    {
      name: "publish_rules",
      discriminator: [213, 245, 134, 186, 168, 25, 143, 233],
      accounts: [
        {
          name: "config",
          writable: true,
          pda: {
            seeds: [
              {
                kind: "const",
                value: [103, 97, 109, 101, 45, 99, 111, 110, 102, 105, 103],
              },
            ],
          },
        },
        {
          name: "admin",
          writable: true,
          signer: true,
          relations: ["config"],
        },
        {
          name: "rules",
          writable: true,
          pda: {
            seeds: [
              {
                kind: "const",
                value: [114, 117, 108, 101, 115],
              },
              {
                kind: "arg",
                path: "args.rules.rules_version",
              },
            ],
          },
        },
        {
          name: "system_program",
          address: "11111111111111111111111111111111",
        },
      ],
      args: [
        {
          name: "args",
          type: {
            defined: {
              name: "PublishRulesArgs",
            },
          },
        },
      ],
    },
    {
      name: "select_cat",
      discriminator: [207, 232, 198, 181, 56, 52, 167, 86],
      accounts: [
        {
          name: "owner",
          signer: true,
          relations: ["collection"],
        },
        {
          name: "collection",
          writable: true,
          pda: {
            seeds: [
              {
                kind: "const",
                value: [99, 111, 108, 108, 101, 99, 116, 105, 111, 110],
              },
              {
                kind: "account",
                path: "owner",
              },
            ],
          },
        },
      ],
      args: [
        {
          name: "args",
          type: {
            defined: {
              name: "SelectCatArgs",
            },
          },
        },
      ],
    },
    {
      name: "set_admission",
      discriminator: [210, 241, 169, 64, 58, 171, 144, 234],
      accounts: [
        {
          name: "config",
          writable: true,
          pda: {
            seeds: [
              {
                kind: "const",
                value: [103, 97, 109, 101, 45, 99, 111, 110, 102, 105, 103],
              },
            ],
          },
        },
        {
          name: "admin",
          signer: true,
          relations: ["config"],
        },
      ],
      args: [
        {
          name: "args",
          type: {
            defined: {
              name: "SetAdmissionArgs",
            },
          },
        },
      ],
    },
    {
      name: "set_house_buffer",
      discriminator: [134, 174, 158, 200, 163, 103, 85, 79],
      accounts: [
        {
          name: "config",
          pda: {
            seeds: [
              {
                kind: "const",
                value: [103, 97, 109, 101, 45, 99, 111, 110, 102, 105, 103],
              },
            ],
          },
          relations: ["house"],
        },
        {
          name: "admin",
          signer: true,
          relations: ["config"],
        },
        {
          name: "house",
          writable: true,
          pda: {
            seeds: [
              {
                kind: "const",
                value: [104, 111, 117, 115, 101],
              },
            ],
          },
        },
        {
          name: "vault",
        },
      ],
      args: [
        {
          name: "args",
          type: {
            defined: {
              name: "AmountArgs",
            },
          },
        },
      ],
    },
    {
      name: "withdraw",
      discriminator: [183, 18, 70, 156, 148, 109, 161, 34],
      accounts: [
        {
          name: "config",
          pda: {
            seeds: [
              {
                kind: "const",
                value: [103, 97, 109, 101, 45, 99, 111, 110, 102, 105, 103],
              },
            ],
          },
          relations: ["house"],
        },
        {
          name: "owner",
          signer: true,
          relations: ["player"],
        },
        {
          name: "player",
          writable: true,
          pda: {
            seeds: [
              {
                kind: "const",
                value: [112, 108, 97, 121, 101, 114],
              },
              {
                kind: "account",
                path: "owner",
              },
            ],
          },
        },
        {
          name: "house",
          writable: true,
          pda: {
            seeds: [
              {
                kind: "const",
                value: [104, 111, 117, 115, 101],
              },
            ],
          },
        },
        {
          name: "vault",
          writable: true,
        },
        {
          name: "owner_tokens",
          writable: true,
        },
        {
          name: "usdc_mint",
          address: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
        },
        {
          name: "token_program",
          address: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
        },
      ],
      args: [
        {
          name: "args",
          type: {
            defined: {
              name: "AmountArgs",
            },
          },
        },
      ],
    },
    {
      name: "withdraw_surplus",
      discriminator: [150, 183, 243, 31, 213, 21, 79, 26],
      accounts: [
        {
          name: "config",
          pda: {
            seeds: [
              {
                kind: "const",
                value: [103, 97, 109, 101, 45, 99, 111, 110, 102, 105, 103],
              },
            ],
          },
          relations: ["house"],
        },
        {
          name: "admin",
          signer: true,
          relations: ["config"],
        },
        {
          name: "house",
          writable: true,
          pda: {
            seeds: [
              {
                kind: "const",
                value: [104, 111, 117, 115, 101],
              },
            ],
          },
        },
        {
          name: "vault",
          writable: true,
        },
        {
          name: "admin_tokens",
          writable: true,
        },
        {
          name: "usdc_mint",
          address: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
        },
        {
          name: "token_program",
          address: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
        },
      ],
      args: [
        {
          name: "args",
          type: {
            defined: {
              name: "AmountArgs",
            },
          },
        },
      ],
    },
  ],
  accounts: [
    {
      name: "CapsuleDraw",
      discriminator: [213, 12, 103, 20, 228, 32, 16, 181],
    },
    {
      name: "CatalogVersion",
      discriminator: [163, 239, 122, 52, 153, 145, 228, 171],
    },
    {
      name: "Collection",
      discriminator: [48, 160, 232, 205, 191, 207, 26, 141],
    },
    {
      name: "Counter",
      discriminator: [255, 176, 4, 245, 188, 253, 124, 25],
    },
    {
      name: "GameConfig",
      discriminator: [45, 146, 146, 33, 170, 69, 96, 133],
    },
    {
      name: "GameRulesVersion",
      discriminator: [75, 201, 160, 57, 27, 46, 192, 251],
    },
    {
      name: "HouseState",
      discriminator: [160, 248, 45, 36, 81, 236, 18, 77],
    },
    {
      name: "PlayerAccount",
      discriminator: [224, 184, 224, 50, 98, 72, 48, 236],
    },
    {
      name: "RunEscrow",
      discriminator: [167, 222, 19, 95, 231, 132, 137, 139],
    },
    {
      name: "RunGameState",
      discriminator: [171, 175, 110, 104, 16, 203, 55, 131],
    },
  ],
  types: [
    {
      name: "AcceptedIntent",
      type: {
        kind: "struct",
        fields: [
          {
            name: "envelope",
            type: {
              defined: {
                name: "IntentEnvelope",
              },
            },
          },
          {
            name: "assigned_tick",
            type: "u64",
          },
          {
            name: "accepted_order",
            type: "u64",
          },
        ],
      },
    },
    {
      name: "AmountArgs",
      type: {
        kind: "struct",
        fields: [
          {
            name: "amount_base_units",
            type: "u64",
          },
        ],
      },
    },
    {
      name: "CapsuleDraw",
      type: {
        kind: "struct",
        fields: [
          {
            name: "schema_version",
            type: "u16",
          },
          {
            name: "bump",
            type: "u8",
          },
          {
            name: "owner",
            type: "pubkey",
          },
          {
            name: "nonce",
            type: "u64",
          },
          {
            name: "kind",
            type: {
              defined: {
                name: "CapsuleKind",
              },
            },
          },
          {
            name: "status",
            type: {
              defined: {
                name: "DrawStatus",
              },
            },
          },
          {
            name: "catalog",
            type: {
              defined: {
                name: "VersionBinding",
              },
            },
          },
          {
            name: "inventory_version",
            type: "u64",
          },
          {
            name: "eligible_mask",
            type: "u8",
          },
          {
            name: "weights",
            type: {
              array: ["u16", 4],
            },
          },
          {
            name: "total_weight",
            type: "u16",
          },
          {
            name: "price_base_units",
            type: "u64",
          },
          {
            name: "vrf_program",
            type: "pubkey",
          },
          {
            name: "vrf_queue",
            type: "pubkey",
          },
          {
            name: "callback_authority",
            type: "pubkey",
          },
          {
            name: "committed_seed_hash",
            type: {
              array: ["u8", 32],
            },
          },
          {
            name: "requested_at_seconds",
            type: "i64",
          },
          {
            name: "paid_deadline_seconds",
            type: {
              option: "i64",
            },
          },
          {
            name: "result",
            type: {
              option: {
                defined: {
                  name: "DrawResult",
                },
              },
            },
          },
          {
            name: "completed_at_seconds",
            type: {
              option: "i64",
            },
          },
        ],
      },
    },
    {
      name: "CapsuleKind",
      type: {
        kind: "enum",
        variants: [
          {
            name: "StarterCat",
          },
          {
            name: "PaidCat",
          },
          {
            name: "Upgrade",
          },
        ],
      },
    },
    {
      name: "CatDefinition",
      type: {
        kind: "struct",
        fields: [
          {
            name: "id",
            type: {
              defined: {
                name: "CatId",
              },
            },
          },
          {
            name: "rarity",
            type: {
              defined: {
                name: "Rarity",
              },
            },
          },
          {
            name: "weight",
            type: "u16",
          },
          {
            name: "power",
            type: {
              defined: {
                name: "Power",
              },
            },
          },
          {
            name: "pickup_radius_bps",
            type: "u16",
          },
          {
            name: "air_control_bps",
            type: "u16",
          },
          {
            name: "dash_duration_bps",
            type: "u16",
          },
          {
            name: "dash_cooldown_bps",
            type: "u16",
          },
        ],
      },
    },
    {
      name: "CatId",
      type: {
        kind: "enum",
        variants: [
          {
            name: "Collector",
          },
          {
            name: "Acrobat",
          },
          {
            name: "Guardian",
          },
          {
            name: "Sprinter",
          },
        ],
      },
    },
    {
      name: "CatSnapshot",
      type: {
        kind: "struct",
        fields: [
          {
            name: "definition",
            type: {
              defined: {
                name: "CatDefinition",
              },
            },
          },
          {
            name: "defining_catalog",
            type: {
              defined: {
                name: "VersionBinding",
              },
            },
          },
          {
            name: "level",
            type: "u8",
          },
          {
            name: "stats",
            type: {
              defined: {
                name: "CatStats",
              },
            },
          },
        ],
      },
    },
    {
      name: "CatStats",
      type: {
        kind: "struct",
        fields: [
          {
            name: "power",
            type: {
              defined: {
                name: "Power",
              },
            },
          },
          {
            name: "power_cooldown_ticks",
            type: "u16",
          },
          {
            name: "pickup_radius_subpixels",
            type: "i32",
          },
          {
            name: "air_control_subpixels_per_tick",
            type: "i32",
          },
          {
            name: "dash_duration_ticks",
            type: "u16",
          },
          {
            name: "dash_cooldown_ticks",
            type: "u16",
          },
        ],
      },
    },
    {
      name: "Catalog",
      type: {
        kind: "struct",
        fields: [
          {
            name: "schema_version",
            type: "u16",
          },
          {
            name: "catalog_version",
            type: "u32",
          },
          {
            name: "cats",
            type: {
              array: [
                {
                  defined: {
                    name: "CatDefinition",
                  },
                },
                4,
              ],
            },
          },
          {
            name: "upgrades",
            type: {
              array: [
                {
                  defined: {
                    name: "UpgradeDefinition",
                  },
                },
                3,
              ],
            },
          },
          {
            name: "starter_price_base_units",
            type: "u64",
          },
          {
            name: "cat_price_base_units",
            type: "u64",
          },
          {
            name: "upgrade_price_base_units",
            type: "u64",
          },
          {
            name: "max_cat_level",
            type: "u8",
          },
          {
            name: "power_cooldown_ticks",
            type: {
              array: ["u16", 5],
            },
          },
          {
            name: "magnet_radius_bps",
            type: "u16",
          },
          {
            name: "power_charges",
            type: "u8",
          },
        ],
      },
    },
    {
      name: "CatalogVersion",
      type: {
        kind: "struct",
        fields: [
          {
            name: "schema_version",
            type: "u16",
          },
          {
            name: "bump",
            type: "u8",
          },
          {
            name: "binding",
            type: {
              defined: {
                name: "VersionBinding",
              },
            },
          },
          {
            name: "catalog",
            type: {
              defined: {
                name: "Catalog",
              },
            },
          },
          {
            name: "asset_manifest",
            type: {
              defined: {
                name: "VersionBinding",
              },
            },
          },
        ],
      },
    },
    {
      name: "Collection",
      type: {
        kind: "struct",
        fields: [
          {
            name: "schema_version",
            type: "u16",
          },
          {
            name: "bump",
            type: "u8",
          },
          {
            name: "owner",
            type: "pubkey",
          },
          {
            name: "inventory_version",
            type: "u64",
          },
          {
            name: "owned_mask",
            type: "u8",
          },
          {
            name: "cats",
            type: {
              array: [
                {
                  option: {
                    defined: {
                      name: "OwnedCat",
                    },
                  },
                },
                4,
              ],
            },
          },
          {
            name: "upgrade_quantities",
            type: {
              array: ["u64", 3],
            },
          },
          {
            name: "selected_cat",
            type: {
              option: {
                defined: {
                  name: "CatId",
                },
              },
            },
          },
          {
            name: "starter",
            type: {
              defined: {
                name: "StarterClaim",
              },
            },
          },
          {
            name: "pending_draw",
            type: {
              option: "pubkey",
            },
          },
        ],
      },
    },
    {
      name: "Counter",
      type: {
        kind: "struct",
        fields: [
          {
            name: "count",
            type: "u64",
          },
          {
            name: "authority",
            type: "pubkey",
          },
        ],
      },
    },
    {
      name: "CrankState",
      type: {
        kind: "struct",
        fields: [
          {
            name: "task",
            type: "pubkey",
          },
          {
            name: "cancel_authority",
            type: "pubkey",
          },
          {
            name: "generation",
            type: "u64",
          },
          {
            name: "last_execution_ordinal",
            type: "u64",
          },
          {
            name: "trusted_elapsed_ms",
            type: "u64",
          },
          {
            name: "consumed_elapsed_ms",
            type: "u64",
          },
          {
            name: "completion_attempts",
            type: "u16",
          },
        ],
      },
    },
    {
      name: "DrawResult",
      type: {
        kind: "enum",
        variants: [
          {
            name: "Cat",
            fields: [
              {
                defined: {
                  name: "CatId",
                },
              },
            ],
          },
          {
            name: "Upgrade",
            fields: [
              {
                defined: {
                  name: "Rarity",
                },
              },
            ],
          },
        ],
      },
    },
    {
      name: "DrawStatus",
      type: {
        kind: "enum",
        variants: [
          {
            name: "Pending",
          },
          {
            name: "Fulfilled",
          },
          {
            name: "Refunded",
          },
        ],
      },
    },
    {
      name: "EntityKind",
      type: {
        kind: "enum",
        variants: [
          {
            name: "Terrain",
          },
          {
            name: "Hazard",
          },
          {
            name: "Coin",
          },
          {
            name: "Star",
          },
          {
            name: "Booster",
            fields: [
              {
                defined: {
                  name: "Power",
                },
              },
            ],
          },
          {
            name: "Ramp",
            fields: ["i32"],
          },
        ],
      },
    },
    {
      name: "EscrowStatus",
      type: {
        kind: "enum",
        variants: [
          {
            name: "Reserved",
          },
          {
            name: "SettledWin",
          },
          {
            name: "SettledLoss",
          },
          {
            name: "RefundedTechnical",
          },
        ],
      },
    },
    {
      name: "FaultReason",
      type: {
        kind: "enum",
        variants: [
          {
            name: "OracleInvalid",
          },
          {
            name: "OracleStale",
          },
          {
            name: "UnsafeWorld",
          },
          {
            name: "SchedulerGap",
          },
          {
            name: "ActivationExpired",
          },
        ],
      },
    },
    {
      name: "GameConfig",
      type: {
        kind: "struct",
        fields: [
          {
            name: "schema_version",
            type: "u16",
          },
          {
            name: "bump",
            type: "u8",
          },
          {
            name: "admin",
            type: "pubkey",
          },
          {
            name: "usdc_mint",
            type: "pubkey",
          },
          {
            name: "token_program",
            type: "pubkey",
          },
          {
            name: "usdc_decimals",
            type: "u8",
          },
          {
            name: "rules",
            type: {
              option: {
                defined: {
                  name: "VersionBinding",
                },
              },
            },
          },
          {
            name: "catalog",
            type: {
              option: {
                defined: {
                  name: "VersionBinding",
                },
              },
            },
          },
          {
            name: "oracle_bindings",
            type: {
              array: [
                {
                  defined: {
                    name: "OracleBinding",
                  },
                },
                3,
              ],
            },
          },
          {
            name: "vrf_program",
            type: "pubkey",
          },
          {
            name: "vrf_queue",
            type: "pubkey",
          },
          {
            name: "vrf_callback_authority",
            type: "pubkey",
          },
          {
            name: "allow_starter",
            type: "bool",
          },
          {
            name: "allow_purchases",
            type: "bool",
          },
          {
            name: "allow_reservations",
            type: "bool",
          },
        ],
      },
    },
    {
      name: "GameRules",
      type: {
        kind: "struct",
        fields: [
          {
            name: "schema_version",
            type: "u16",
          },
          {
            name: "rules_version",
            type: "u32",
          },
          {
            name: "ticks_per_second",
            type: "u16",
          },
          {
            name: "checkpoint_ticks",
            type: "u16",
          },
          {
            name: "designated_coins",
            type: "u8",
          },
          {
            name: "qualification_coins",
            type: "u8",
          },
          {
            name: "initial_multiplier_bps",
            type: {
              array: ["u32", 6],
            },
          },
          {
            name: "multiplier_step_bps",
            type: "u32",
          },
          {
            name: "max_multiplier_bps",
            type: "u32",
          },
          {
            name: "speed_step_bps",
            type: "u16",
          },
          {
            name: "max_speed_bps",
            type: "u16",
          },
          {
            name: "power_duration_ticks",
            type: "u16",
          },
          {
            name: "shield_contact_ticks",
            type: "u16",
          },
          {
            name: "heartbeat_grace_ticks",
            type: "u16",
          },
          {
            name: "activation_timeout_seconds",
            type: "u16",
          },
          {
            name: "suspension_timeout_seconds",
            type: "u16",
          },
          {
            name: "paid_draw_timeout_seconds",
            type: "u16",
          },
          {
            name: "crank_interval_ms",
            type: "u16",
          },
          {
            name: "max_ticks_per_crank",
            type: "u8",
          },
          {
            name: "max_queued_intents",
            type: "u8",
          },
          {
            name: "max_control_updates_per_second",
            type: "u8",
          },
          {
            name: "max_prediction_ticks",
            type: "u8",
          },
          {
            name: "max_local_intents",
            type: "u16",
          },
          {
            name: "max_world_entities",
            type: "u8",
          },
          {
            name: "max_recent_observations",
            type: "u8",
          },
          {
            name: "physics",
            type: {
              defined: {
                name: "PhysicsRules",
              },
            },
          },
          {
            name: "generation",
            type: {
              defined: {
                name: "GenerationRules",
              },
            },
          },
          {
            name: "score",
            type: {
              defined: {
                name: "ScoreRules",
              },
            },
          },
        ],
      },
    },
    {
      name: "GameRulesVersion",
      type: {
        kind: "struct",
        fields: [
          {
            name: "schema_version",
            type: "u16",
          },
          {
            name: "bump",
            type: "u8",
          },
          {
            name: "binding",
            type: {
              defined: {
                name: "VersionBinding",
              },
            },
          },
          {
            name: "rules",
            type: {
              defined: {
                name: "GameRules",
              },
            },
          },
        ],
      },
    },
    {
      name: "GenerationRules",
      type: {
        kind: "struct",
        fields: [
          {
            name: "segment_width_subpixels",
            type: "i32",
          },
          {
            name: "lookahead_segments",
            type: "u8",
          },
          {
            name: "flat_band_bps",
            type: "u16",
          },
          {
            name: "sharp_move_bps",
            type: "u16",
          },
          {
            name: "max_sample_change_bps",
            type: "u16",
          },
          {
            name: "designated_coin_ticks",
            type: {
              array: ["u16", 5],
            },
          },
          {
            name: "max_hazards_per_segment",
            type: "u8",
          },
          {
            name: "max_optional_pickups_per_segment",
            type: "u8",
          },
          {
            name: "booster_stride_segments",
            type: "u16",
          },
        ],
      },
    },
    {
      name: "GenerationState",
      type: {
        kind: "struct",
        fields: [
          {
            name: "next_segment",
            type: "u64",
          },
          {
            name: "next_x_subpixels",
            type: "i32",
          },
          {
            name: "surface_y_subpixels",
            type: "i32",
          },
          {
            name: "checkpoint",
            type: "u64",
          },
          {
            name: "checkpoint_x_subpixels",
            type: "i32",
          },
          {
            name: "checkpoint_speed_subpixels_per_tick",
            type: "i32",
          },
          {
            name: "spawned_coin_mask",
            type: "u8",
          },
          {
            name: "spawned_hazard_mask",
            type: "u8",
          },
        ],
      },
    },
    {
      name: "HostedOracleQuote",
      type: {
        kind: "struct",
        fields: [
          {
            name: "write_authority",
            type: "pubkey",
          },
          {
            name: "verification_level",
            type: "u8",
          },
          {
            name: "feed_id",
            type: {
              array: ["u8", 32],
            },
          },
          {
            name: "price",
            type: "i64",
          },
          {
            name: "confidence",
            type: "u64",
          },
          {
            name: "exponent",
            type: "i32",
          },
          {
            name: "published_at_seconds",
            type: "i64",
          },
          {
            name: "previous_published_at_seconds",
            type: "i64",
          },
          {
            name: "ema_price",
            type: "i64",
          },
          {
            name: "ema_confidence",
            type: "u64",
          },
          {
            name: "posted_slot",
            type: "u64",
          },
        ],
      },
    },
    {
      name: "HouseState",
      type: {
        kind: "struct",
        fields: [
          {
            name: "schema_version",
            type: "u16",
          },
          {
            name: "bump",
            type: "u8",
          },
          {
            name: "config",
            type: "pubkey",
          },
          {
            name: "usdc_mint",
            type: "pubkey",
          },
          {
            name: "vault",
            type: "pubkey",
          },
          {
            name: "total_available_base_units",
            type: "u64",
          },
          {
            name: "total_purchase_escrow_base_units",
            type: "u64",
          },
          {
            name: "total_max_gross_base_units",
            type: "u64",
          },
          {
            name: "buffer_base_units",
            type: "u64",
          },
        ],
      },
    },
    {
      name: "InitializeConfigArgs",
      type: {
        kind: "struct",
        fields: [
          {
            name: "oracle_bindings",
            type: {
              array: [
                {
                  defined: {
                    name: "OracleBinding",
                  },
                },
                3,
              ],
            },
          },
        ],
      },
    },
    {
      name: "InputAxis",
      type: {
        kind: "enum",
        variants: [
          {
            name: "Left",
          },
          {
            name: "Neutral",
          },
          {
            name: "Right",
          },
        ],
      },
    },
    {
      name: "InputPermission",
      type: {
        kind: "struct",
        fields: [
          {
            name: "owner",
            type: "pubkey",
          },
          {
            name: "input_key",
            type: "pubkey",
          },
          {
            name: "program",
            type: "pubkey",
          },
          {
            name: "session_token",
            type: "pubkey",
          },
          {
            name: "expires_at_seconds",
            type: "i64",
          },
        ],
      },
    },
    {
      name: "InspectedOracle",
      type: {
        kind: "struct",
        fields: [
          {
            name: "market",
            type: {
              defined: {
                name: "Market",
              },
            },
          },
          {
            name: "quote",
            type: {
              defined: {
                name: "HostedOracleQuote",
              },
            },
          },
          {
            name: "content_hash",
            type: {
              array: ["u8", 32],
            },
          },
        ],
      },
    },
    {
      name: "IntentEnvelope",
      type: {
        kind: "struct",
        fields: [
          {
            name: "protocol_version",
            type: "u16",
          },
          {
            name: "rules_version",
            type: "u32",
          },
          {
            name: "run",
            type: "pubkey",
          },
          {
            name: "client_sequence",
            type: "u64",
          },
          {
            name: "action",
            type: {
              defined: {
                name: "PlayerIntent",
              },
            },
          },
        ],
      },
    },
    {
      name: "Market",
      type: {
        kind: "enum",
        variants: [
          {
            name: "Btc",
          },
          {
            name: "Eth",
          },
          {
            name: "Sol",
          },
        ],
      },
    },
    {
      name: "OracleBinding",
      type: {
        kind: "struct",
        fields: [
          {
            name: "program",
            type: "pubkey",
          },
          {
            name: "account",
            type: "pubkey",
          },
          {
            name: "write_authority",
            type: "pubkey",
          },
          {
            name: "validator",
            type: "pubkey",
          },
          {
            name: "feed_id",
            type: "u32",
          },
          {
            name: "schema_version",
            type: "u16",
          },
          {
            name: "max_age_seconds",
            type: "u16",
          },
          {
            name: "max_future_skew_seconds",
            type: "u16",
          },
          {
            name: "min_exponent",
            type: "i32",
          },
          {
            name: "max_exponent",
            type: "i32",
          },
        ],
      },
    },
    {
      name: "OracleObservation",
      type: {
        kind: "struct",
        fields: [
          {
            name: "sequence",
            type: "u64",
          },
          {
            name: "price",
            type: "i64",
          },
          {
            name: "exponent",
            type: "i32",
          },
          {
            name: "published_at_seconds",
            type: "i64",
          },
          {
            name: "posted_slot",
            type: "u64",
          },
          {
            name: "content_hash",
            type: {
              array: ["u8", 32],
            },
          },
        ],
      },
    },
    {
      name: "OwnedCat",
      type: {
        kind: "struct",
        fields: [
          {
            name: "cat",
            type: {
              defined: {
                name: "CatId",
              },
            },
          },
          {
            name: "rarity",
            type: {
              defined: {
                name: "Rarity",
              },
            },
          },
          {
            name: "defining_catalog",
            type: {
              defined: {
                name: "VersionBinding",
              },
            },
          },
          {
            name: "level",
            type: "u8",
          },
        ],
      },
    },
    {
      name: "PhysicsRules",
      type: {
        kind: "struct",
        fields: [
          {
            name: "subpixels_per_pixel",
            type: "u16",
          },
          {
            name: "viewport_width_pixels",
            type: "u16",
          },
          {
            name: "viewport_height_pixels",
            type: "u16",
          },
          {
            name: "coordinate_limit_subpixels",
            type: "i32",
          },
          {
            name: "max_velocity_subpixels_per_tick",
            type: "i32",
          },
          {
            name: "runner_speed_subpixels_per_tick",
            type: "i32",
          },
          {
            name: "speed_easing_subpixels_per_tick",
            type: "i32",
          },
          {
            name: "jump_velocity_subpixels_per_tick",
            type: "i32",
          },
          {
            name: "gravity_subpixels_per_tick_squared",
            type: "i32",
          },
          {
            name: "air_control_subpixels_per_tick",
            type: "i32",
          },
          {
            name: "dash_bonus_subpixels_per_tick",
            type: "i32",
          },
          {
            name: "dash_duration_ticks",
            type: "u16",
          },
          {
            name: "dash_cooldown_ticks",
            type: "u16",
          },
          {
            name: "pickup_radius_subpixels",
            type: "i32",
          },
          {
            name: "hitbox_width_subpixels",
            type: "i32",
          },
          {
            name: "hitbox_height_subpixels",
            type: "i32",
          },
          {
            name: "max_required_gap_subpixels",
            type: "i32",
          },
          {
            name: "max_required_rise_subpixels",
            type: "i32",
          },
          {
            name: "min_landing_width_subpixels",
            type: "i32",
          },
          {
            name: "min_required_coin_spacing_ticks",
            type: "u16",
          },
        ],
      },
      docs: [
        "Positions are segment-local signed subpixels (256/pixel), y increases down.",
        "Velocities are subpixels/tick; gravity is subpixels/tick². Widen products to",
        "i64 and divide toward zero; money uses u128 and rounds down. Never use floats.",
        "Rebase the world origin before a coordinate leaves the published bound;",
        "distance/score/ticks/sequences use checked u64, never wrapping counters.",
        "Each tick: ordered commands -> gravity/velocity -> swept terrain X then Y ->",
        "hazards by entity ID -> pickups by entity ID -> checkpoint if still alive.",
        "Touching edges count as terrain contact, but not hazard/pickup overlap.",
        "MOVE is a -1/0/+1 airborne horizontal offset, not an acceleration. Grounded",
        "Jump sets vy to jump_velocity; gravity applies before position integration.",
        "Ease automatic speed toward the level target while grounded, retain it in",
        "air, then add air control and any dash bonus; clamp velocity before sweeping.",
        "Geometry caps are necessary, not a reachability proof: generated required",
        "routes must still pass the base-control solver for every cat at level 1.",
        "The first terminal stops the tick. Effect end ticks are exclusive; a power",
        "armed at tick t is live through t+179. Suspension advances no active timers.",
      ],
    },
    {
      name: "PlayerAccount",
      type: {
        kind: "struct",
        fields: [
          {
            name: "schema_version",
            type: "u16",
          },
          {
            name: "bump",
            type: "u8",
          },
          {
            name: "owner",
            type: "pubkey",
          },
          {
            name: "available_base_units",
            type: "u64",
          },
          {
            name: "locked_stake_base_units",
            type: "u64",
          },
          {
            name: "purchase_escrow_base_units",
            type: "u64",
          },
          {
            name: "next_run_nonce",
            type: "u64",
          },
          {
            name: "next_draw_nonce",
            type: "u64",
          },
          {
            name: "next_session_nonce",
            type: "u64",
          },
          {
            name: "settled_runs",
            type: "u64",
          },
          {
            name: "wins",
            type: "u64",
          },
          {
            name: "losses",
            type: "u64",
          },
          {
            name: "technical_refunds",
            type: "u64",
          },
        ],
      },
    },
    {
      name: "PlayerIntent",
      type: {
        kind: "enum",
        variants: [
          {
            name: "Move",
            fields: [
              {
                name: "axis",
                type: {
                  defined: {
                    name: "InputAxis",
                  },
                },
              },
            ],
          },
          {
            name: "Jump",
          },
          {
            name: "Dash",
          },
          {
            name: "Boost",
          },
          {
            name: "CashOut",
          },
          {
            name: "Surrender",
          },
          {
            name: "Heartbeat",
            fields: [
              {
                name: "active",
                type: "bool",
              },
            ],
          },
          {
            name: "Inactive",
          },
        ],
      },
    },
    {
      name: "Power",
      type: {
        kind: "enum",
        variants: [
          {
            name: "Magnet",
          },
          {
            name: "DoubleJump",
          },
          {
            name: "Shield",
          },
          {
            name: "ExtraDash",
          },
        ],
      },
    },
    {
      name: "PowerState",
      type: {
        kind: "struct",
        fields: [
          {
            name: "ready_at_tick",
            type: "u64",
          },
          {
            name: "ends_at_tick",
            type: "u64",
          },
          {
            name: "charges",
            type: "u8",
          },
        ],
      },
    },
    {
      name: "PublishCatalogArgs",
      type: {
        kind: "struct",
        fields: [
          {
            name: "expected_current_version",
            type: "u32",
          },
          {
            name: "catalog",
            type: {
              defined: {
                name: "Catalog",
              },
            },
          },
          {
            name: "asset_manifest",
            type: {
              defined: {
                name: "VersionBinding",
              },
            },
          },
        ],
      },
    },
    {
      name: "PublishRulesArgs",
      type: {
        kind: "struct",
        fields: [
          {
            name: "expected_current_version",
            type: "u32",
          },
          {
            name: "rules",
            type: {
              defined: {
                name: "GameRules",
              },
            },
          },
        ],
      },
    },
    {
      name: "Rarity",
      type: {
        kind: "enum",
        variants: [
          {
            name: "Common",
          },
          {
            name: "Rare",
          },
          {
            name: "Epic",
          },
        ],
      },
    },
    {
      name: "RequestCapsuleArgs",
      type: {
        kind: "struct",
        fields: [
          {
            name: "expected_draw_nonce",
            type: "u64",
          },
          {
            name: "expected_inventory_version",
            type: "u64",
          },
          {
            name: "expected_catalog_version",
            type: "u32",
          },
          {
            name: "kind",
            type: {
              defined: {
                name: "CapsuleKind",
              },
            },
          },
          {
            name: "max_payer_debit_lamports",
            type: "u64",
          },
        ],
      },
    },
    {
      name: "RunEscrow",
      type: {
        kind: "struct",
        fields: [
          {
            name: "schema_version",
            type: "u16",
          },
          {
            name: "bump",
            type: "u8",
          },
          {
            name: "game_state",
            type: "pubkey",
          },
          {
            name: "snapshot",
            type: {
              defined: {
                name: "RunSnapshot",
              },
            },
          },
          {
            name: "snapshot_hash",
            type: {
              array: ["u8", 32],
            },
          },
          {
            name: "sponsor_budget",
            type: "pubkey",
          },
          {
            name: "delegation_initiated",
            type: "bool",
          },
          {
            name: "status",
            type: {
              defined: {
                name: "EscrowStatus",
              },
            },
          },
          {
            name: "receipt",
            type: {
              option: "pubkey",
            },
          },
        ],
      },
    },
    {
      name: "RunGameState",
      type: {
        kind: "struct",
        fields: [
          {
            name: "schema_version",
            type: "u16",
          },
          {
            name: "bump",
            type: "u8",
          },
          {
            name: "escrow",
            type: "pubkey",
          },
          {
            name: "snapshot",
            type: {
              defined: {
                name: "RunSnapshot",
              },
            },
          },
          {
            name: "snapshot_hash",
            type: {
              array: ["u8", 32],
            },
          },
          {
            name: "phase",
            type: {
              defined: {
                name: "RunPhase",
              },
            },
          },
          {
            name: "active_ticks",
            type: "u64",
          },
          {
            name: "world_origin_pixels",
            type: "u64",
          },
          {
            name: "runner",
            type: {
              defined: {
                name: "RunnerState",
              },
            },
          },
          {
            name: "entities",
            type: {
              vec: {
                defined: {
                  name: "WorldEntity",
                },
              },
            },
          },
          {
            name: "entity_count",
            type: "u8",
          },
          {
            name: "next_entity_id",
            type: "u64",
          },
          {
            name: "observations",
            type: {
              vec: {
                defined: {
                  name: "OracleObservation",
                },
              },
            },
          },
          {
            name: "observation_head",
            type: "u8",
          },
          {
            name: "observation_count",
            type: "u8",
          },
          {
            name: "start_observation",
            type: {
              option: {
                defined: {
                  name: "OracleObservation",
                },
              },
            },
          },
          {
            name: "intents",
            type: {
              vec: {
                option: {
                  defined: {
                    name: "AcceptedIntent",
                  },
                },
              },
            },
          },
          {
            name: "intent_head",
            type: "u8",
          },
          {
            name: "intent_count",
            type: "u8",
          },
          {
            name: "last_accepted_sequence",
            type: "u64",
          },
          {
            name: "last_processed_sequence",
            type: "u64",
          },
          {
            name: "last_accepted_order",
            type: "u64",
          },
          {
            name: "control_window_seconds",
            type: "i64",
          },
          {
            name: "control_updates_in_window",
            type: "u8",
          },
          {
            name: "last_heartbeat_tick",
            type: "u64",
          },
          {
            name: "inactive_exit_tick",
            type: {
              option: "u64",
            },
          },
          {
            name: "key_exit_tick",
            type: {
              option: "u64",
            },
          },
          {
            name: "input_key_revoked",
            type: "bool",
          },
          {
            name: "score",
            type: "u64",
          },
          {
            name: "total_coins",
            type: "u64",
          },
          {
            name: "designated_coin_mask",
            type: "u8",
          },
          {
            name: "qualified_checkpoints",
            type: "u64",
          },
          {
            name: "powers",
            type: {
              array: [
                {
                  defined: {
                    name: "PowerState",
                  },
                },
                4,
              ],
            },
          },
          {
            name: "crank",
            type: {
              defined: {
                name: "CrankState",
              },
            },
          },
          {
            name: "world_generation",
            type: {
              defined: {
                name: "GenerationState",
              },
            },
          },
          {
            name: "suspension",
            type: {
              option: {
                defined: {
                  name: "Suspension",
                },
              },
            },
          },
          {
            name: "terminal",
            type: {
              option: {
                defined: {
                  name: "RunTerminal",
                },
              },
            },
          },
        ],
      },
    },
    {
      name: "RunPhase",
      type: {
        kind: "enum",
        variants: [
          {
            name: "Ready",
          },
          {
            name: "Active",
          },
          {
            name: "Suspended",
          },
          {
            name: "TerminalRecorded",
          },
          {
            name: "CompletionRequested",
          },
        ],
      },
    },
    {
      name: "RunSnapshot",
      type: {
        kind: "struct",
        fields: [
          {
            name: "protocol_version",
            type: "u16",
          },
          {
            name: "run",
            type: "pubkey",
          },
          {
            name: "owner",
            type: "pubkey",
          },
          {
            name: "nonce",
            type: "u64",
          },
          {
            name: "market",
            type: {
              defined: {
                name: "Market",
              },
            },
          },
          {
            name: "stake_base_units",
            type: "u64",
          },
          {
            name: "max_gross_base_units",
            type: "u64",
          },
          {
            name: "rules_binding",
            type: {
              defined: {
                name: "VersionBinding",
              },
            },
          },
          {
            name: "rules",
            type: {
              defined: {
                name: "GameRules",
              },
            },
          },
          {
            name: "cat",
            type: {
              defined: {
                name: "CatSnapshot",
              },
            },
          },
          {
            name: "oracle",
            type: {
              defined: {
                name: "OracleBinding",
              },
            },
          },
          {
            name: "input_permission",
            type: {
              defined: {
                name: "InputPermission",
              },
            },
          },
          {
            name: "asset_manifest",
            type: {
              defined: {
                name: "VersionBinding",
              },
            },
          },
          {
            name: "activation_deadline_seconds",
            type: "i64",
          },
          {
            name: "delegation_epoch",
            type: "u64",
          },
        ],
      },
    },
    {
      name: "RunStatusView",
      type: {
        kind: "struct",
        fields: [
          {
            name: "phase",
            type: {
              defined: {
                name: "RunPhase",
              },
            },
          },
          {
            name: "active_ticks",
            type: "u64",
          },
          {
            name: "accepted_sequence",
            type: "u64",
          },
          {
            name: "processed_sequence",
            type: "u64",
          },
        ],
      },
    },
    {
      name: "RunTerminal",
      type: {
        kind: "struct",
        fields: [
          {
            name: "reason",
            type: {
              defined: {
                name: "TerminalReason",
              },
            },
          },
          {
            name: "fault",
            type: {
              option: {
                defined: {
                  name: "FaultReason",
                },
              },
            },
          },
          {
            name: "active_ticks",
            type: "u64",
          },
          {
            name: "qualified_checkpoints",
            type: "u64",
          },
          {
            name: "score",
            type: "u64",
          },
          {
            name: "coins",
            type: "u64",
          },
          {
            name: "processed_sequence",
            type: "u64",
          },
          {
            name: "final_observation",
            type: {
              option: {
                defined: {
                  name: "OracleObservation",
                },
              },
            },
          },
          {
            name: "gross_payout_base_units",
            type: "u64",
          },
          {
            name: "refund_base_units",
            type: "u64",
          },
        ],
      },
    },
    {
      name: "RunnerState",
      type: {
        kind: "struct",
        fields: [
          {
            name: "x_subpixels",
            type: "i32",
          },
          {
            name: "y_subpixels",
            type: "i32",
          },
          {
            name: "vx_subpixels_per_tick",
            type: "i32",
          },
          {
            name: "vy_subpixels_per_tick",
            type: "i32",
          },
          {
            name: "automatic_speed_subpixels_per_tick",
            type: "i32",
          },
          {
            name: "grounded",
            type: "bool",
          },
          {
            name: "axis",
            type: {
              defined: {
                name: "InputAxis",
              },
            },
          },
          {
            name: "dash_ends_at_tick",
            type: "u64",
          },
          {
            name: "dash_ready_at_tick",
            type: "u64",
          },
          {
            name: "shield_contact_ends_at_tick",
            type: "u64",
          },
        ],
      },
    },
    {
      name: "ScoreRules",
      type: {
        kind: "struct",
        fields: [
          {
            name: "coin_points",
            type: "u16",
          },
          {
            name: "star_points",
            type: "u16",
          },
        ],
      },
    },
    {
      name: "SelectCatArgs",
      type: {
        kind: "struct",
        fields: [
          {
            name: "expected_inventory_version",
            type: "u64",
          },
          {
            name: "cat",
            type: {
              defined: {
                name: "CatId",
              },
            },
          },
        ],
      },
    },
    {
      name: "SetAdmissionArgs",
      type: {
        kind: "struct",
        fields: [
          {
            name: "starter",
            type: "bool",
          },
          {
            name: "purchases",
            type: "bool",
          },
          {
            name: "reservations",
            type: "bool",
          },
        ],
      },
    },
    {
      name: "StarterClaim",
      type: {
        kind: "enum",
        variants: [
          {
            name: "Unclaimed",
          },
          {
            name: "Pending",
          },
          {
            name: "Fulfilled",
          },
        ],
      },
    },
    {
      name: "Suspension",
      type: {
        kind: "struct",
        fields: [
          {
            name: "reason",
            type: {
              defined: {
                name: "FaultReason",
              },
            },
          },
          {
            name: "started_at_seconds",
            type: "i64",
          },
        ],
      },
    },
    {
      name: "TerminalReason",
      type: {
        kind: "enum",
        variants: [
          {
            name: "CashOut",
          },
          {
            name: "Crash",
          },
          {
            name: "AutoCashOut",
          },
          {
            name: "Surrender",
          },
          {
            name: "TechnicalAbort",
          },
        ],
      },
    },
    {
      name: "UpgradeDefinition",
      type: {
        kind: "struct",
        fields: [
          {
            name: "rarity",
            type: {
              defined: {
                name: "Rarity",
              },
            },
          },
          {
            name: "weight",
            type: "u16",
          },
          {
            name: "level_gain",
            type: "u8",
          },
        ],
      },
    },
    {
      name: "VersionBinding",
      type: {
        kind: "struct",
        fields: [
          {
            name: "version",
            type: "u32",
          },
          {
            name: "content_hash",
            type: {
              array: ["u8", 32],
            },
          },
        ],
      },
    },
    {
      name: "WorldEntity",
      type: {
        kind: "struct",
        fields: [
          {
            name: "id",
            type: "u64",
          },
          {
            name: "kind",
            type: {
              defined: {
                name: "EntityKind",
              },
            },
          },
          {
            name: "x_subpixels",
            type: "i32",
          },
          {
            name: "y_subpixels",
            type: "i32",
          },
          {
            name: "width_subpixels",
            type: "i32",
          },
          {
            name: "height_subpixels",
            type: "i32",
          },
          {
            name: "designated_coin",
            type: {
              option: "u8",
            },
          },
          {
            name: "designated_checkpoint",
            type: "u64",
          },
          {
            name: "consumed",
            type: "bool",
          },
        ],
      },
    },
  ],
  errors: [
    {
      code: 6000,
      name: "Unauthorized",
      msg: "Only the counter authority can update this counter",
    },
    {
      code: 6001,
      name: "CounterOverflow",
      msg: "Counter has reached the maximum value",
    },
    {
      code: 6002,
      name: "InvalidUpgradeAuthority",
      msg: "Only the program upgrade authority can initialize configuration",
    },
    {
      code: 6003,
      name: "InvalidAdmin",
      msg: "Only the configured admin can publish versions",
    },
    {
      code: 6004,
      name: "InvalidConfiguration",
      msg: "Unsupported configuration schema",
    },
    {
      code: 6005,
      name: "InvalidMint",
      msg: "Only official six-decimal Devnet USDC is supported",
    },
    {
      code: 6006,
      name: "InvalidOracleBinding",
      msg: "Oracle identity, schema or numeric policy does not match the market",
    },
    {
      code: 6007,
      name: "InvalidOracleData",
      msg: "Oracle account data is malformed or does not match its binding",
    },
    {
      code: 6008,
      name: "StaleOracle",
      msg: "Oracle observation is stale",
    },
    {
      code: 6009,
      name: "InvalidRules",
      msg: "Published rules must preserve the reviewed numeric contract",
    },
    {
      code: 6010,
      name: "InvalidCatalog",
      msg: "Published catalog must preserve the approved product values",
    },
    {
      code: 6011,
      name: "StaleVersion",
      msg: "Publication version is stale or does not advance exactly once",
    },
    {
      code: 6012,
      name: "InvalidManifest",
      msg: "A nonzero version and content hash are required for media",
    },
    {
      code: 6013,
      name: "ArithmeticOverflow",
      msg: "Integer range exceeded",
    },
    {
      code: 6014,
      name: "InvalidAmount",
      msg: "A positive token amount is required",
    },
    {
      code: 6015,
      name: "InvalidOwner",
      msg: "Token owner or player identity is invalid",
    },
    {
      code: 6016,
      name: "InvalidVault",
      msg: "The custody vault is invalid or has an external delegate/close authority",
    },
    {
      code: 6017,
      name: "InsufficientCredit",
      msg: "Insufficient settled available credit",
    },
    {
      code: 6018,
      name: "InsolventHouse",
      msg: "The vault does not cover all obligations and the required buffer",
    },
    {
      code: 6019,
      name: "InvalidRun",
      msg: "Run identity or frozen snapshot is invalid",
    },
    {
      code: 6020,
      name: "AdmissionClosed",
      msg: "This operation is paused or its implementation is not admitted",
    },
    {
      code: 6021,
      name: "InvalidInventory",
      msg: "Inventory, draw identity or version is stale",
    },
    {
      code: 6022,
      name: "StarterAlreadyClaimed",
      msg: "The starter draw is already pending or fulfilled",
    },
    {
      code: 6023,
      name: "InvalidCallback",
      msg: "The callback does not match the frozen pending request",
    },
    {
      code: 6024,
      name: "InvalidSession",
      msg: "Invalid or exhausted session authorization",
    },
    {
      code: 6025,
      name: "InvalidSponsorBudget",
      msg: "Invalid or insufficient purpose-bound sponsor funding",
    },
  ],
  constants: [
    {
      name: "COUNTER_SEED",
      type: "bytes",
      value: "[99, 111, 117, 110, 116, 101, 114]",
    },
    {
      name: "HELLO_WORLD_LAMPORTS",
      type: "u64",
      value: "1",
    },
    {
      name: "MAX_COUNT",
      type: "u64",
      value: "10",
    },
  ],
} satisfies AnchorIdl;

plugins {
    id("org.jetbrains.intellij") version "1.17.0"
    kotlin("jvm") version "1.9.22"
}

group = "com.jdcagnet.ide"
version = property("pluginVersion") as String

repositories {
    mavenCentral()
}

dependencies {
    implementation("io.ktor:ktor-server-netty:2.3.7")
    implementation("io.ktor:ktor-server-websockets:2.3.7")
    implementation("com.google.code.gson:gson:2.10.1")
    testImplementation(kotlin("test"))
}

intellij {
    version.set(property("platformVersion") as String)
    type.set("IC")
}

tasks {
    patchPluginXml {
        sinceBuild.set("231")
        untilBuild.set("")
    }
}

kotlin {
    jvmToolchain(17)
}

java {
    toolchain {
        languageVersion.set(JavaLanguageVersion.of(17))
    }
}

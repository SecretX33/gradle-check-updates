import org.jetbrains.kotlin.gradle.dsl.JvmTarget
import org.jetbrains.kotlin.gradle.tasks.KotlinCompile

plugins {
    alias(libs.plugins.spring.boot)
    alias(libs.plugins.spring.dependency.management)
    alias(libs.plugins.kotlin.jvm)
    alias(libs.plugins.kotlin.jpa)
    alias(libs.plugins.kotlin.serialization)
    alias(libs.plugins.kotlin.allopen)
    id("java-test-fixtures")
}

group = "com.example.ai.services"
version = "1.0.0-SNAPSHOT"

java {
    sourceCompatibility = JavaVersion.VERSION_21
    targetCompatibility = JavaVersion.VERSION_21
}

tasks.withType<KotlinCompile> {
    compilerOptions {
        jvmTarget.set(JvmTarget.JVM_21)
        freeCompilerArgs.set(listOf(
            "-Xjsr305=strict",
            "-Xannotation-default-target=param-property"
        ))
    }
}

dependencies {
    implementation(project(":app:common"))
    implementation(project(":app:ai:m1-data"))
    implementation(project(":app:content:m1-data"))

    implementation(libs.spring.boot.starter.data.jpa)
    implementation(libs.spring.boot.starter.data.redis)
    implementation(libs.spring.boot.starter.web)
    implementation(libs.spring.boot.starter.validation)
    implementation(libs.spring.boot.starter.webflux)
    implementation(libs.postgresql)

    implementation(libs.bundles.kotlin.core)
    implementation(libs.bundles.kotlin.coroutines)
    implementation(libs.arrow.core)

    implementation(libs.commons.csv)
    implementation(libs.commons.lang3)
    implementation(libs.metadata.extractor)

    // LLM Ops
    implementation(platform(libs.langchain4j.bom))
    implementation(libs.bundles.langchain4j)
    implementation(libs.langchain4j.web.search.engine.tavily)

    // Google GenAI SDK for bleeding-edge features like Google Maps grounding
    implementation(libs.google.genai)

    // Anthropic Java SDK for adaptive thinking (Claude 4.6+)
    // OkHttp transport excluded — using AnthropicHttpClientAdapter backed by Apache HTTP5
    implementation(libs.anthropic.java) {
        exclude(group = "com.anthropic", module = "anthropic-java-client-okhttp")
    }
    implementation(libs.anthropic.java.core)
    implementation(libs.anthropic.java.bedrock)

    // HTTP Clients for LangChain4j
    implementation(libs.httpclient5)
    implementation(libs.httpcore5)
    implementation(libs.httpcore5.h2)

    // Logbook for outgoing HTTP client call logging
    implementation(libs.logbook.httpclient5)
    implementation(libs.logbook.spring.webflux)

    // Google Maps for LocationTools
    implementation(libs.bundles.google.maps)

    // AWS SDK for Bedrock
    implementation(libs.aws.sdk.bedrock)
    implementation(libs.aws.sdk.sso)
    implementation(libs.aws.sdk.ssooidc)

    // serializable
    implementation(libs.hypersistence.utils)

    testImplementation("org.springframework.boot:spring-boot-starter-test")
    testImplementation(libs.h2)
    testImplementation(libs.mockk)
    testImplementation(libs.kotlin.test.junit5)
    testImplementation(libs.kotlinx.coroutines.test)

    testFixturesImplementation(libs.kotlin.stdlib)
    testFixturesImplementation(libs.jakarta.persistence.api)
}

allOpen {
    annotation("jakarta.persistence.Entity")
    annotation("org.springframework.stereotype.Component")
    annotation("org.springframework.stereotype.Repository")
}

tasks.jar {
    enabled = true
    archiveBaseName.set("ai-services")
    archiveClassifier.set("")
}

tasks.bootJar {
    enabled = false
}
